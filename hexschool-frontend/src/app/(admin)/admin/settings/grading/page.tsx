"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  schoolApi,
  type GradePointInput,
  type GradingSystem,
} from "@/lib/api/school";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  findCoverageIssues,
  findOverlapIssues,
} from "@/lib/utils/grade-ranges";

/** Grading system editor with live overlap/gap warnings (roadmap M04 §5). */
export default function GradingSystemsPage() {
  const query = useQuery({
    queryKey: ["grading-systems"],
    queryFn: schoolApi.listGradingSystems,
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) {
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return <GradingList systems={query.data} />;
}

function GradingList({ systems }: { systems: GradingSystem[] }) {
  const { can } = usePermissions();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <Can permission="grading.create">
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)} disabled={creating}>
            <Plus className="size-4" /> New grading system
          </Button>
        </div>
      </Can>

      {creating ? (
        <SystemEditor
          system={null}
          editable
          onClose={() => setCreating(false)}
        />
      ) : null}

      {systems.map((system) => (
        <SystemEditor
          key={`${system.id}:${system.updatedAt}`}
          system={system}
          editable={can("grading.update")}
        />
      ))}
    </div>
  );
}

interface RowState {
  grade: string;
  point: string;
  minMark: string;
  maxMark: string;
}

const toRows = (system: GradingSystem | null): RowState[] =>
  system
    ? system.gradePoints.map((p) => ({
        grade: p.grade,
        point: String(p.point),
        minMark: String(p.minMark),
        maxMark: String(p.maxMark),
      }))
    : [{ grade: "", point: "", minMark: "", maxMark: "" }];

function SystemEditor({
  system,
  editable,
  onClose,
}: {
  system: GradingSystem | null;
  editable: boolean;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(system?.name ?? "");
  const [rows, setRows] = useState<RowState[]>(() => toRows(system));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["grading-systems"] });

  const bands = rows.map((r) => ({
    grade: r.grade,
    minMark: Number(r.minMark),
    maxMark: Number(r.maxMark),
  }));
  const overlapIssues = findOverlapIssues(bands);
  const coverageIssues = findCoverageIssues(bands);

  const toPayload = (): GradePointInput[] =>
    rows.map((r) => ({
      grade: r.grade.trim(),
      point: Number(r.point),
      minMark: Number(r.minMark),
      maxMark: Number(r.maxMark),
    }));

  const save = useMutation({
    mutationFn: () =>
      system
        ? schoolApi.updateGradingSystem(system.id, {
            name,
            gradePoints: toPayload(),
          })
        : schoolApi.createGradingSystem({ name, gradePoints: toPayload() }),
    onSuccess: () => {
      toast.success(system ? "Grading system saved" : "Grading system created");
      refresh();
      onClose?.();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const makeDefault = useMutation({
    mutationFn: () =>
      schoolApi.updateGradingSystem(system!.id, { isDefault: true }),
    onSuccess: () => {
      toast.success(`"${system!.name}" is now the default`);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => schoolApi.deleteGradingSystem(system!.id),
    onSuccess: () => {
      toast.success("Grading system deleted");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const setRow = (index: number, patch: Partial<RowState>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grading system name"
              className="w-64"
              disabled={!editable}
              aria-label="Grading system name"
            />
            {system?.isDefault ? <Badge>Default</Badge> : null}
          </div>
          {system && editable ? (
            <div className="flex items-center gap-2">
              {!system.isDefault ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={makeDefault.isPending || coverageIssues.length > 0}
                    title={
                      coverageIssues.length > 0
                        ? "Needs full 0–100 coverage first"
                        : undefined
                    }
                    onClick={() => makeDefault.mutate()}
                  >
                    Make default
                  </Button>
                  <Can permission="grading.delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </Can>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium">Point</th>
                <th className="px-3 py-2 font-medium">Min mark</th>
                <th className="px-3 py-2 font-medium">Max mark</th>
                {editable ? <th className="w-10 px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <Input
                      value={row.grade}
                      disabled={!editable}
                      onChange={(e) => setRow(i, { grade: e.target.value })}
                      className="h-8 w-20"
                      aria-label={`Grade label row ${i + 1}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      value={row.point}
                      disabled={!editable}
                      onChange={(e) => setRow(i, { point: e.target.value })}
                      className="h-8 w-24"
                      aria-label={`Grade point row ${i + 1}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      value={row.minMark}
                      disabled={!editable}
                      onChange={(e) => setRow(i, { minMark: e.target.value })}
                      className="h-8 w-24"
                      aria-label={`Min mark row ${i + 1}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      value={row.maxMark}
                      disabled={!editable}
                      onChange={(e) => setRow(i, { maxMark: e.target.value })}
                      className="h-8 w-24"
                      aria-label={`Max mark row ${i + 1}`}
                    />
                  </td>
                  {editable ? (
                    <td className="px-3 py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() =>
                          setRows((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  { grade: "", point: "", minMark: "", maxMark: "" },
                ])
              }
            >
              <Plus className="size-4" /> Add grade
            </Button>
            <Button
              size="sm"
              disabled={
                save.isPending || overlapIssues.length > 0 || !name.trim()
              }
              onClick={() => save.mutate()}
            >
              {system ? "Save changes" : "Create system"}
            </Button>
            {onClose ? (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Live validation warnings (roadmap M04 §5) */}
        {editable && overlapIssues.length > 0 ? (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {overlapIssues.map((issue, i) => (
              <li key={`o-${i}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
        {editable && overlapIssues.length === 0 && coverageIssues.length > 0 ? (
          <ul className="space-y-1 text-sm text-amber-600 dark:text-amber-400">
            {coverageIssues.map((issue, i) => (
              <li key={`c-${i}`}>
                {issue.message} (blocks “make default” only)
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      {system ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete "${system.name}"?`}
          description="Soft-deletes the grading system. The default cannot be deleted."
          confirmLabel="Delete"
          destructive
          isPending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      ) : null}
    </Card>
  );
}
