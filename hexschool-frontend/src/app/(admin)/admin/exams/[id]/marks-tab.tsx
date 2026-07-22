"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  markApi,
  markErrorsFromError,
  type MarkComponent,
} from "@/lib/api/result";
import { cn } from "@/lib/utils";
import {
  allocatedComponents,
  COMPONENT_LABELS,
  draftError,
  draftFromRow,
  draftToInput,
  draftTotal,
  isDraftFilled,
  MARK_STATUS_LABELS,
  MARK_STATUS_VARIANT,
  NEXT_MARK_ACTION,
  type DraftMark,
} from "@/lib/validations/result";

/**
 * Keyboard-first mark entry (roadmap M15 §5).
 *
 * The grid is built around how marks are actually entered: a stack of
 * scripts and someone typing numbers as fast as they can read them. So
 * Enter and the arrow keys move down the column rather than across the
 * row, every cell validates against the paper's own allocation as it is
 * typed (the backend engine, mirrored), and the save is all-or-nothing —
 * a refused payload paints every bad cell at once instead of surfacing
 * them one round-trip at a time.
 */
export function MarksTab({ examId }: { examId: string }) {
  const qc = useQueryClient();
  const [chosenPaper, setChosenPaper] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftMark>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const statuses = useQuery({
    queryKey: ["mark-statuses", examId],
    queryFn: () => markApi.statuses(examId),
  });

  // Derived, not stored: until the user picks one, the active paper is
  // the first that still needs work — which is the one they came for.
  const paperId =
    chosenPaper ||
    (statuses.data?.find((p) => p.status !== "LOCKED") ?? statuses.data?.[0])
      ?.examSubjectId ||
    "";

  const grid = useQuery({
    queryKey: ["mark-grid", examId, paperId],
    queryFn: () => markApi.grid(examId, { examSubjectId: paperId }),
    enabled: paperId !== "",
    // A background refetch must never overwrite half-typed marks; the
    // grid reloads only when this component invalidates it (after a save
    // or a lifecycle move).
    refetchOnWindowFocus: false,
  });

  // Seeding the editable drafts from a fetch is state derived from
  // props, so it is adjusted DURING RENDER against the fetch's identity
  // rather than in an effect — an effect here would cascade a second
  // render on every load (and the React Compiler rightly refuses it).
  const gridKey = grid.data ? `${paperId}:${grid.dataUpdatedAt}` : null;
  if (grid.data && gridKey !== loadedKey) {
    setLoadedKey(gridKey);
    setDrafts(
      Object.fromEntries(
        grid.data.rows.map((row) => [row.enrollmentId, draftFromRow(row)]),
      ),
    );
    setServerErrors({});
  }

  const paper = grid.data?.paper;
  const columns = useMemo<MarkComponent[]>(
    () => (paper ? allocatedComponents(paper) : []),
    [paper],
  );

  const rows = useMemo(() => grid.data?.rows ?? [], [grid.data]);
  const clientErrors = useMemo(() => {
    if (!paper) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const row of rows) {
      const draft = drafts[row.enrollmentId];
      if (!draft) continue;
      const error = draftError(paper, draft);
      if (error) map[row.enrollmentId] = error;
    }
    return map;
  }, [paper, rows, drafts]);

  const filled = paper
    ? rows.filter((row) => {
        const draft = drafts[row.enrollmentId];
        return draft && isDraftFilled(paper, draft);
      }).length
    : 0;
  const invalid = Object.keys(clientErrors).length;

  const save = useMutation({
    mutationFn: async () => {
      if (!paper) return;
      const marks = rows
        .filter((row) => {
          const draft = drafts[row.enrollmentId];
          return draft && isDraftFilled(paper, draft);
        })
        .map((row) =>
          draftToInput(paper, row.enrollmentId, drafts[row.enrollmentId]),
        );
      return markApi.save(examId, {
        examSubjectId: paper.examSubjectId,
        marks,
      });
    },
    onSuccess: (result) => {
      setServerErrors({});
      toast.success(`${result?.saved ?? 0} mark(s) saved`);
      void qc.invalidateQueries({ queryKey: ["mark-grid", examId, paperId] });
      void qc.invalidateQueries({ queryKey: ["mark-statuses", examId] });
    },
    onError: (error) => {
      // Every offending cell comes back at once so the grid can paint
      // them all — that is the point of the all-or-nothing contract.
      const cells = markErrorsFromError(error);
      setServerErrors(
        Object.fromEntries(cells.map((c) => [c.enrollmentId, c.message])),
      );
      toast.error(apiErrorMessage(error));
    },
  });

  const advance = useMutation({
    mutationFn: (action: "submit" | "verify" | "lock") =>
      markApi.advance(examId, action, paperId),
    onSuccess: (result) => {
      toast.success(`Paper is now ${MARK_STATUS_LABELS[result.status]}`);
      void qc.invalidateQueries({ queryKey: ["mark-grid", examId, paperId] });
      void qc.invalidateQueries({ queryKey: ["mark-statuses", examId] });
      void qc.invalidateQueries({ queryKey: ["process-status", examId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const setCell = (
    enrollmentId: string,
    field: keyof DraftMark,
    value: string | boolean,
  ) => {
    setDrafts((current) => ({
      ...current,
      [enrollmentId]: { ...current[enrollmentId], [field]: value },
    }));
    setServerErrors((current) => {
      if (!current[enrollmentId]) return current;
      const next = { ...current };
      delete next[enrollmentId];
      return next;
    });
  };

  /** Enter / ↓ / ↑ move down the COLUMN — how a stack of scripts is read. */
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: string,
  ) => {
    const step =
      event.key === "Enter" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const target = rows[rowIndex + step];
    if (!target) return;
    cellRefs.current[`${target.enrollmentId}:${field}`]?.focus();
    cellRefs.current[`${target.enrollmentId}:${field}`]?.select();
  };

  if (statuses.isLoading) return <LoadingBlock />;
  if (!statuses.data?.length) {
    return (
      <EmptyState
        title="No papers yet"
        description="Add subjects to this exam before entering marks."
      />
    );
  }

  const status = grid.data?.status ?? "DRAFT";
  const next = NEXT_MARK_ACTION[status];
  const editable = grid.data?.editable ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label className="text-muted-foreground mb-1 block text-xs">
            Paper
          </label>
          <Select value={paperId} onValueChange={setChosenPaper}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a paper" />
            </SelectTrigger>
            <SelectContent>
              {statuses.data.map((p) => (
                <SelectItem key={p.examSubjectId} value={p.examSubjectId}>
                  {p.className} — {p.subjectName} ({p.entered}/{p.candidates}
                  {p.status === "LOCKED" ? ", locked" : ""})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Badge variant={MARK_STATUS_VARIANT[status]}>
          {MARK_STATUS_LABELS[status]}
        </Badge>

        {next && (
          <Can permission={next.permission}>
            <Button
              variant="outline"
              disabled={advance.isPending || filled < rows.length}
              onClick={() => advance.mutate(next.action)}
              title={
                filled < rows.length
                  ? "Every candidate needs a mark (or an absence) first"
                  : undefined
              }
            >
              {advance.isPending && <Spinner className="mr-2 h-4 w-4" />}
              {next.label}
            </Button>
          </Can>
        )}
      </div>

      {grid.isLoading ? (
        <LoadingBlock />
      ) : !paper ? (
        <EmptyState title="Pick a paper" description="Choose a paper above." />
      ) : (
        <>
          {paper.isOptional && (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
              This is an optional (4th) subject — only the {rows.length}{" "}
              student(s) who chose it appear here.
            </p>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Roll</th>
                  <th className="px-3 py-2 text-left font-medium">Student</th>
                  {columns.length === 0 ? (
                    <th className="px-3 py-2 text-right font-medium">
                      Marks / {paper.fullMarks}
                    </th>
                  ) : (
                    columns.map((c) => (
                      <th key={c} className="px-3 py-2 text-right font-medium">
                        {COMPONENT_LABELS[c]} / {paper.componentMarks[c]}
                      </th>
                    ))
                  )}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-center font-medium">Absent</th>
                  <th className="px-3 py-2 text-left font-medium">Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const draft = drafts[row.enrollmentId];
                  if (!draft) return null;
                  const error =
                    clientErrors[row.enrollmentId] ??
                    serverErrors[row.enrollmentId];
                  const total = draftTotal(paper, draft);

                  return (
                    <tr
                      key={row.enrollmentId}
                      className={cn(
                        "border-t",
                        error && "bg-destructive/5",
                        draft.isAbsent && "text-muted-foreground",
                      )}
                    >
                      <td className="px-3 py-1.5">{row.rollNo}</td>
                      <td className="px-3 py-1.5">
                        <div>{row.studentName}</div>
                        {error && (
                          <div className="text-destructive text-xs">{error}</div>
                        )}
                      </td>

                      {(columns.length === 0
                        ? (["total"] as const)
                        : columns
                      ).map((field) => (
                        <td key={field} className="px-3 py-1.5 text-right">
                          <Input
                            ref={(el) => {
                              cellRefs.current[`${row.enrollmentId}:${field}`] =
                                el;
                            }}
                            className="ml-auto h-8 w-20 text-right"
                            inputMode="decimal"
                            disabled={!editable || draft.isAbsent}
                            value={draft[field]}
                            onChange={(e) =>
                              setCell(row.enrollmentId, field, e.target.value)
                            }
                            onKeyDown={(e) => onKeyDown(e, index, field)}
                          />
                        </td>
                      ))}

                      <td className="px-3 py-1.5 text-right font-medium">
                        {draft.isAbsent ? "—" : total}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <Checkbox
                          disabled={!editable}
                          checked={draft.isAbsent}
                          onCheckedChange={(checked) => {
                            const absent = checked === true;
                            setDrafts((current) => ({
                              ...current,
                              [row.enrollmentId]: absent
                                ? {
                                    // Ticking absent clears the row — the
                                    // DB CHECK refuses "absent with 45".
                                    cq: "",
                                    mcq: "",
                                    practical: "",
                                    ca: "",
                                    total: "",
                                    isAbsent: true,
                                  }
                                : { ...current[row.enrollmentId], isAbsent: false },
                            }));
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        {row.grade ? (
                          <Badge variant="outline">{row.grade}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Sticky save bar — the M13/M14 grid convention. */}
          <div className="bg-background/95 sticky bottom-0 flex flex-wrap items-center gap-3 border-t py-3 backdrop-blur">
            <span className="text-muted-foreground text-sm">
              {filled} of {rows.length} entered
              {invalid > 0 && (
                <span className="text-destructive"> · {invalid} invalid</span>
              )}
            </span>
            <div className="flex-1" />
            <Can permission="mark.entry">
              <Button
                disabled={!editable || save.isPending || invalid > 0 || filled === 0}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Spinner className="mr-2 h-4 w-4" />}
                Save marks
              </Button>
            </Can>
          </div>

          {!editable && (
            <p className="text-muted-foreground text-xs">
              This paper is {MARK_STATUS_LABELS[status].toLowerCase()} — a
              locked mark changes only through the correction flow, which
              records a reason.
            </p>
          )}
        </>
      )}
    </div>
  );
}
