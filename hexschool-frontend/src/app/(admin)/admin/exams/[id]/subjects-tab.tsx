"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  examApi,
  paperErrorsFromError,
  type ExamSubject,
  type ExamSubjectInput,
} from "@/lib/api/exam";
import { cn } from "@/lib/utils";
import { timeOf, validateDistribution } from "@/lib/validations/exam";

/** One editable row of the distribution grid. */
interface Row extends ExamSubjectInput {
  id: string | null;
  className: string;
  subjectName: string;
  subjectCode: string;
}

/** Strips the display-only fields the grid carries for rendering. */
const toPayload = (row: Row): ExamSubjectInput => ({
  classId: row.classId,
  subjectId: row.subjectId,
  fullMarks: row.fullMarks,
  passMarks: row.passMarks,
  cqMarks: row.cqMarks,
  mcqMarks: row.mcqMarks,
  practicalMarks: row.practicalMarks,
  caMarks: row.caMarks,
  cqPassMarks: row.cqPassMarks,
  mcqPassMarks: row.mcqPassMarks,
  practicalPassMarks: row.practicalPassMarks,
  caPassMarks: row.caPassMarks,
  examDate: row.examDate,
  startTime: row.startTime,
  durationMin: row.durationMin,
  room: row.room,
});

/** Grid identity — a paper is one class × one subject of the exam. */
const rowKey = (row: Pick<Row, "classId" | "subjectId">): string =>
  `${row.classId}|${row.subjectId}`;

const toRow = (paper: ExamSubject): Row => ({
  id: paper.id,
  classId: paper.classId,
  subjectId: paper.subjectId,
  className: paper.class.name,
  subjectName: paper.subject.name,
  subjectCode: paper.subject.code,
  fullMarks: paper.fullMarks,
  passMarks: paper.passMarks,
  cqMarks: paper.cqMarks,
  mcqMarks: paper.mcqMarks,
  practicalMarks: paper.practicalMarks,
  caMarks: paper.caMarks,
  cqPassMarks: paper.cqPassMarks,
  mcqPassMarks: paper.mcqPassMarks,
  practicalPassMarks: paper.practicalPassMarks,
  caPassMarks: paper.caPassMarks,
  examDate: paper.examDate,
  startTime: timeOf(paper.startTime) || null,
  durationMin: paper.durationMin,
  room: paper.room,
});

/**
 * The mark-distribution grid (the exam wizard's third step). Rows are
 * validated client-side against the same rules the backend enforces, so
 * a bad component split is red before it is submitted — but the save is
 * still all-or-nothing on the server.
 */
export function SubjectsTab({
  examId,
  editable,
}: {
  examId: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const papers = useQuery({
    queryKey: ["exam-subjects", examId],
    queryFn: () => examApi.subjects(examId),
  });

  const sync = useQuery({
    queryKey: ["exam-subjects-sync", examId],
    queryFn: () => examApi.syncPreview(examId),
    enabled: editable,
  });

  /**
   * Edits are held as an overlay keyed by class+subject rather than as a
   * copy of the server rows, so the grid is derived during render and a
   * background refetch cannot silently clobber what the user is typing.
   */
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});

  const rows = useMemo<Row[]>(
    () =>
      (papers.data ?? []).map((paper) => {
        const base = toRow(paper);
        return { ...base, ...edits[rowKey(base)] };
      }),
    [papers.data, edits],
  );

  const dirty = Object.keys(edits).length > 0;

  const rowErrors = useMemo(
    () => rows.map((row) => validateDistribution(row)),
    [rows],
  );
  const invalid = rowErrors.some((e) => e.length > 0);

  const patch = (index: number, changes: Partial<Row>) => {
    const key = rowKey(rows[index]);
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...changes } }));
  };

  const save = useMutation({
    mutationFn: (override: boolean) =>
      examApi.replaceSubjects(examId, {
        override,
        subjects: rows.map(toPayload),
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.saved} paper(s) saved${result.removed > 0 ? `, ${result.removed} removed` : ""}.`,
      );
      setServerErrors([]);
      setEdits({});
      void qc.invalidateQueries({ queryKey: ["exam-subjects", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
      void qc.invalidateQueries({ queryKey: ["exam-routine", examId] });
    },
    onError: (err) => {
      const errors = paperErrorsFromError(err);
      setServerErrors(errors);
      toast.error(errors.length > 0 ? "Some rows are invalid." : apiErrorMessage(err));
    },
  });

  const applySync = useMutation({
    mutationFn: (input: { addMissing?: boolean; removeStale?: boolean }) =>
      examApi.syncApply(examId, input),
    onSuccess: (result) => {
      toast.success(
        `${result.added} paper(s) added, ${result.removed} removed.`,
      );
      void qc.invalidateQueries({ queryKey: ["exam-subjects", examId] });
      void qc.invalidateQueries({ queryKey: ["exam-subjects-sync", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (papers.isPending) return <LoadingBlock />;
  if (papers.isError) {
    return <ErrorState onRetry={() => void papers.refetch()} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No papers yet"
        description="Attach classes to this exam — one paper per curriculum subject is seeded automatically."
      />
    );
  }

  const diff = sync.data;
  const hasDiff =
    diff && (diff.missing.length > 0 || diff.stale.length > 0);

  return (
    <div className="space-y-4">
      {hasDiff ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">The class curricula have changed</p>
          <p className="mt-1 text-muted-foreground">
            {diff.missing.length} subject(s) have no paper
            {diff.stale.length > 0
              ? `, and ${diff.stale.length} paper(s) are for subjects that left the curriculum`
              : ""}
            .
          </p>
          <div className="mt-3 flex gap-2">
            <Can permission="exam.manage">
              <Button
                size="sm"
                disabled={diff.missing.length === 0 || applySync.isPending}
                onClick={() => applySync.mutate({ addMissing: true })}
              >
                Add {diff.missing.length} missing
              </Button>
              {diff.stale.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={applySync.isPending}
                  onClick={() =>
                    applySync.mutate({ addMissing: false, removeStale: true })
                  }
                >
                  Remove {diff.stale.length} stale
                </Button>
              ) : null}
            </Can>
          </div>
        </div>
      ) : null}

      {serverErrors.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            The server refused the whole grid — nothing was saved
          </p>
          <ul className="mt-2 list-inside list-disc text-muted-foreground">
            {serverErrors.slice(0, 8).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">Class / Subject</TableHead>
              <TableHead className="w-20">Full</TableHead>
              <TableHead className="w-20">Pass</TableHead>
              <TableHead className="w-20">CQ</TableHead>
              <TableHead className="w-20">MCQ</TableHead>
              <TableHead className="w-24">Practical</TableHead>
              <TableHead className="w-20">CA</TableHead>
              <TableHead className="w-36">Date</TableHead>
              <TableHead className="w-28">Start</TableHead>
              <TableHead className="w-24">Minutes</TableHead>
              <TableHead className="w-24">Room</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const errors = rowErrors[index];
              return (
                <TableRow
                  key={`${row.classId}|${row.subjectId}`}
                  className={cn(errors.length > 0 && "bg-destructive/5")}
                >
                  <TableCell>
                    <div className="font-medium">{row.subjectName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.className} · {row.subjectCode}
                    </div>
                    {errors.length > 0 ? (
                      <div className="mt-1 text-xs text-destructive">
                        {errors[0]}
                      </div>
                    ) : null}
                  </TableCell>
                  <NumberCell
                    value={row.fullMarks}
                    disabled={!editable}
                    onChange={(v) => patch(index, { fullMarks: v ?? 0 })}
                  />
                  <NumberCell
                    value={row.passMarks}
                    disabled={!editable}
                    onChange={(v) => patch(index, { passMarks: v ?? 0 })}
                  />
                  <NumberCell
                    value={row.cqMarks}
                    disabled={!editable}
                    nullable
                    onChange={(v) => patch(index, { cqMarks: v })}
                  />
                  <NumberCell
                    value={row.mcqMarks}
                    disabled={!editable}
                    nullable
                    onChange={(v) => patch(index, { mcqMarks: v })}
                  />
                  <NumberCell
                    value={row.practicalMarks}
                    disabled={!editable}
                    nullable
                    onChange={(v) => patch(index, { practicalMarks: v })}
                  />
                  <NumberCell
                    value={row.caMarks}
                    disabled={!editable}
                    nullable
                    onChange={(v) => patch(index, { caMarks: v })}
                  />
                  <TableCell>
                    <Input
                      type="date"
                      className="h-8"
                      disabled={!editable}
                      value={row.examDate ?? ""}
                      onChange={(e) =>
                        patch(index, { examDate: e.target.value || null })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      className="h-8"
                      disabled={!editable}
                      value={row.startTime ?? ""}
                      onChange={(e) =>
                        patch(index, { startTime: e.target.value || null })
                      }
                    />
                  </TableCell>
                  <NumberCell
                    value={row.durationMin}
                    disabled={!editable}
                    nullable
                    onChange={(v) => patch(index, { durationMin: v })}
                  />
                  <TableCell>
                    <Input
                      className="h-8"
                      maxLength={20}
                      disabled={!editable}
                      value={row.room ?? ""}
                      onChange={(e) =>
                        patch(index, { room: e.target.value || null })
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editable ? (
        <Can permission="exam.manage">
          <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-md border bg-background p-3 shadow-sm">
            <div className="text-sm text-muted-foreground">
              {invalid ? (
                <span className="text-destructive">
                  {rowErrors.filter((e) => e.length > 0).length} row(s) need
                  fixing
                </span>
              ) : dirty ? (
                "Unsaved changes"
              ) : (
                "All changes saved"
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setEdits({});
                  setServerErrors([]);
                }}
              >
                Reset
              </Button>
              <Button
                disabled={invalid || save.isPending}
                onClick={() => save.mutate(false)}
              >
                {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
                Save papers
              </Button>
              <Button
                variant="secondary"
                disabled={invalid || save.isPending}
                title="Saves despite a same-day warning (needs exam.schedule.override)"
                onClick={() => save.mutate(true)}
              >
                Save with override
              </Button>
            </div>
          </div>
        </Can>
      ) : (
        <Badge variant="secondary">
          Read-only — the exam has moved past paper editing
        </Badge>
      )}
    </div>
  );
}

/** A compact numeric grid cell; blank means "not used" when nullable. */
function NumberCell({
  value,
  onChange,
  disabled,
  nullable = false,
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  nullable?: boolean;
}) {
  return (
    <TableCell>
      <Input
        type="number"
        min={0}
        className="h-8"
        disabled={disabled}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(nullable ? null : 0);
            return;
          }
          onChange(Number(raw));
        }}
      />
    </TableCell>
  );
}
