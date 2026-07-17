"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { schoolApi } from "@/lib/api/school";
import { teachersApi, type TeacherEvaluation } from "@/lib/api/teachers";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  evaluationSchema,
  type EvaluationValues,
} from "@/lib/validations/teacher";

const DEFAULT_CRITERIA = [
  "Subject knowledge",
  "Class management",
  "Punctuality",
  "Lesson planning",
  "Student engagement",
];

/** Criteria come from settings (academic.teacher_evaluation_criteria). */
export function EvaluationsTab({ teacherId }: { teacherId: string }) {
  const { selected: session } = useAcademicSession();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<TeacherEvaluation | null>(
    null,
  );

  const evaluations = useQuery({
    queryKey: ["teacher-evaluations", teacherId, session?.id],
    queryFn: () => teachersApi.listEvaluations(teacherId, session?.id),
  });

  // Criteria names are configurable; fall back to the defaults when the
  // actor lacks settings.view.
  const criteriaSetting = useQuery({
    queryKey: ["settings", "academic"],
    queryFn: () => schoolApi.getSettings("academic"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const criteria: string[] = (() => {
    const raw = criteriaSetting.data?.find(
      (s) => s.key === "academic.teacher_evaluation_criteria",
    )?.value;
    return Array.isArray(raw) && raw.every((c) => typeof c === "string")
      ? (raw as string[])
      : DEFAULT_CRITERIA;
  })();

  const form = useForm<EvaluationValues>({
    resolver: zodResolver(evaluationSchema),
    defaultValues: { evaluatedAt: "", remarks: "" },
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["teacher-evaluations", teacherId],
    });

  const create = useMutation({
    mutationFn: (values: EvaluationValues) => {
      const numeric = Object.fromEntries(
        criteria
          .filter((c) => scores[c] !== undefined && scores[c] !== "")
          .map((c) => [c, Number(scores[c])]),
      );
      const nums = Object.values(numeric);
      const overall =
        nums.length > 0
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) /
            100
          : 0;
      return teachersApi.createEvaluation(teacherId, {
        sessionId: session!.id,
        criteria: numeric,
        score: overall,
        remarks: values.remarks || undefined,
        evaluatedAt: values.evaluatedAt,
      });
    },
    onSuccess: () => {
      toast.success("Evaluation recorded");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (eid: string) => teachersApi.removeEvaluation(teacherId, eid),
    onSuccess: () => {
      toast.success("Evaluation deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const scoresValid =
    criteria.some((c) => scores[c]) &&
    criteria.every((c) => {
      const v = scores[c];
      if (v === undefined || v === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    });

  if (!session) {
    return (
      <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        Evaluations are session-scoped — pick an academic session in the
        header.
      </p>
    );
  }
  if (evaluations.isPending) return <LoadingBlock />;
  if (evaluations.isError) {
    return (
      <ErrorState
        error={evaluations.error}
        onRetry={() => void evaluations.refetch()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Can permission="teacher.evaluation.manage">
        <div className="flex justify-end">
          <Button
            onClick={() => {
              form.reset({ evaluatedAt: "", remarks: "" });
              setScores({});
              setDialogOpen(true);
            }}
          >
            New evaluation
          </Button>
        </div>
      </Can>

      {evaluations.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No evaluations in session {session.name}.
        </p>
      ) : (
        <div className="space-y-3">
          {evaluations.data.map((evaluation) => (
            <div key={evaluation.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {Number(evaluation.score).toFixed(1)}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                  <Badge variant="outline">
                    {evaluation.evaluatedAt.slice(0, 10)}
                  </Badge>
                </div>
                <Can permission="teacher.evaluation.manage">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(evaluation)}
                  >
                    Delete
                  </Button>
                </Can>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {Object.entries(evaluation.criteria).map(([name, value]) => (
                  <span key={name} className="rounded-md bg-muted px-2 py-1">
                    {name}: <span className="font-medium">{value}</span>
                  </span>
                ))}
              </div>
              {evaluation.remarks ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {evaluation.remarks}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="New evaluation"
        description={`Session ${session.name} — the overall score is the average of the filled criteria (0–100).`}
        form={form}
        onSubmit={(values) => {
          if (scoresValid) create.mutate(values);
          else toast.error("Fill at least one criterion with a 0–100 score");
        }}
        submitLabel="Record"
        isPending={create.isPending}
      >
        <div className="grid grid-cols-2 gap-4">
          {criteria.map((criterion) => (
            <div key={criterion} className="space-y-2">
              <Label>{criterion}</Label>
              <Input
                inputMode="numeric"
                placeholder="0–100"
                value={scores[criterion] ?? ""}
                onChange={(e) =>
                  setScores((prev) => ({
                    ...prev,
                    [criterion]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="eval-date">Evaluated on</Label>
            <Input
              id="eval-date"
              type="date"
              {...form.register("evaluatedAt")}
            />
            {form.formState.errors.evaluatedAt?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.evaluatedAt.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="eval-remarks">Remarks (optional)</Label>
            <Input id="eval-remarks" {...form.register("remarks")} />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this evaluation?"
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={() => {
          if (deleteTarget) del.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
