"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi } from "@/lib/api/structure";
import { usePermissions } from "@/lib/hooks/use-permissions";

const NONE = "__none__";

interface RowState {
  subjectId: string;
  groupId: string; // "" = all groups
  isOptional: boolean;
  fullMarks: string;
}

/**
 * Curriculum editor (roadmap M06 §5): ordered subject rows with
 * optional-flag (4th subject), default full marks, and per-group rows.
 * Order via up/down arrows; PUT replaces the whole mapping.
 */
export function SubjectsTab({
  classId,
  classLevel,
  sessionId,
}: {
  classId: string;
  classLevel: number;
  sessionId: string;
}) {
  const mapping = useQuery({
    queryKey: ["class-subjects", classId, sessionId],
    queryFn: () => structureApi.getClassSubjects(classId, sessionId),
  });

  if (mapping.isPending) return <LoadingBlock />;
  if (mapping.isError) {
    return (
      <ErrorState error={mapping.error} onRetry={() => void mapping.refetch()} />
    );
  }

  return (
    <MappingEditor
      // Remount with fresh rows whenever the server mapping changes.
      key={`${classId}:${sessionId}:${mapping.dataUpdatedAt}`}
      classId={classId}
      classLevel={classLevel}
      sessionId={sessionId}
      initial={mapping.data.map((r) => ({
        subjectId: r.subjectId,
        groupId: r.groupId ?? "",
        isOptional: r.isOptional,
        fullMarks: String(r.fullMarksDefault),
      }))}
    />
  );
}

function MappingEditor({
  classId,
  classLevel,
  sessionId,
  initial,
}: {
  classId: string;
  classLevel: number;
  sessionId: string;
  initial: RowState[];
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const editable = can("class.subject.assign");

  const subjects = useQuery({
    queryKey: ["subjects", "all"],
    queryFn: () => structureApi.subjects.list({ limit: 100, sort: "name:asc" }),
    staleTime: 60_000,
  });
  const groups = useQuery({
    queryKey: ["groups", "all"],
    queryFn: () => structureApi.groups.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const [rows, setRows] = useState<RowState[]>(initial);
  const [addId, setAddId] = useState("");

  const save = useMutation({
    mutationFn: () =>
      structureApi.setClassSubjects(
        classId,
        sessionId,
        rows.map((r) => ({
          subjectId: r.subjectId,
          groupId: r.groupId || undefined,
          isOptional: r.isOptional,
          fullMarksDefault: r.fullMarks ? Number(r.fullMarks) : undefined,
        })),
      ),
    onSuccess: () => {
      toast.success("Subject mapping saved");
      void queryClient.invalidateQueries({
        queryKey: ["class-subjects", classId, sessionId],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (subjects.isPending) return <LoadingBlock />;

  const allSubjects = subjects.data?.data ?? [];
  const subjectOf = (id: string) => allSubjects.find((s) => s.id === id);
  const applicableGroups = (groups.data?.data ?? []).filter(
    (g) => g.applicableFromLevel <= classLevel,
  );
  const available = allSubjects.filter(
    (s) => !rows.some((r) => r.subjectId === s.id && r.groupId === ""),
  );

  const move = (index: number, delta: number) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const patch = (index: number, part: Partial<RowState>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...part } : row)),
    );

  return (
    <div className="space-y-3">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={addId || NONE} onValueChange={(v) => setAddId(v === NONE ? "" : v)}>
            <SelectTrigger className="w-64" aria-label="Add subject">
              <SelectValue placeholder="Add a subject…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Add a subject…</SelectItem>
              {available.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!addId}
            onClick={() => {
              setRows((prev) => [
                ...prev,
                { subjectId: addId, groupId: "", isOptional: false, fullMarks: "100" },
              ]);
              setAddId("");
            }}
          >
            <Plus className="size-4" /> Add
          </Button>
          <div className="ml-auto">
            <Can permission="class.subject.assign">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                Save mapping
              </Button>
            </Can>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No subjects mapped for this session yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="w-20 px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium">Optional (4th)</th>
                <th className="px-3 py-2 font-medium">Full marks</th>
                {editable ? <th className="w-10 px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => {
                const subject = subjectOf(row.subjectId);
                return (
                  <tr key={`${row.subjectId}:${row.groupId}`}>
                    <td className="px-3 py-1.5">
                      {editable ? (
                        <span className="flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${subject?.name} up`}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${subject?.name} down`}
                            disabled={i === rows.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                        </span>
                      ) : (
                        <span className="tabular-nums">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-medium">
                      {subject ? `${subject.name} (${subject.code})` : row.subjectId}
                      {subject?.type !== "THEORY" ? (
                        <Badge variant="outline" className="ml-1.5">
                          {subject?.type}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={row.groupId || NONE}
                        onValueChange={(v) =>
                          patch(i, { groupId: v === NONE ? "" : v })
                        }
                        disabled={!editable}
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>All groups</SelectItem>
                          {applicableGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={row.isOptional}
                        disabled={!editable}
                        onChange={(e) => patch(i, { isOptional: e.target.checked })}
                        aria-label={`${subject?.name} optional`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        className="h-8 w-24"
                        value={row.fullMarks}
                        disabled={!editable}
                        onChange={(e) => patch(i, { fullMarks: e.target.value })}
                        aria-label={`${subject?.name} full marks`}
                      />
                    </td>
                    {editable ? (
                      <td className="px-3 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Remove ${subject?.name}`}
                          onClick={() =>
                            setRows((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
