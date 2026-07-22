"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import { examApi, type ExamStatus } from "@/lib/api/exam";
import { cn } from "@/lib/utils";
import { EXAM_STATUS_LABELS, EXAM_STATUS_VARIANT } from "@/lib/validations/exam";
import { AdmitCardsTab } from "./admit-cards-tab";
import { RoutineTab } from "./routine-tab";
import { SeatPlansTab } from "./seat-plans-tab";
import { SubjectsTab } from "./subjects-tab";

const TABS = [
  ["subjects", "Papers & marks"],
  ["routine", "Routine"],
  ["seat-plans", "Seat plan"],
  ["admit-cards", "Admit cards"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function ExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("subjects");
  const [statusOpen, setStatusOpen] = useState(false);

  const overview = useQuery({
    queryKey: ["exam", id],
    queryFn: () => examApi.get(id),
  });

  if (overview.isPending) return <LoadingBlock />;
  if (overview.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void overview.refetch()} />
      </main>
    );
  }

  const { exam, papers, seatPlans, nextStatuses, shapeEditable } =
    overview.data;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={exam.name}
        description={`${exam.examType.name} · ${exam.session.name} · ${exam.startDate} → ${exam.endDate} · graded on ${exam.gradingSystem.name}`}
      >
        <Button variant="outline" asChild>
          <Link href="/admin/exams">Back</Link>
        </Button>
        <Can permission="exam.export">
          <Button
            variant="outline"
            onClick={() =>
              void examApi
                .downloadRoutine(id)
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Routine PDF
          </Button>
        </Can>
        <Can permission="exam.status">
          <Button
            disabled={nextStatuses.length === 0}
            onClick={() => setStatusOpen(true)}
          >
            Change status
          </Button>
        </Can>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={EXAM_STATUS_VARIANT[exam.status]}>
          {EXAM_STATUS_LABELS[exam.status]}
        </Badge>
        {!shapeEditable ? (
          <span className="text-sm text-muted-foreground">
            Classes and papers are frozen at this stage.
          </span>
        ) : null}
        {exam.resultPublishAt ? (
          <span className="text-sm text-muted-foreground">
            Published {exam.resultPublishAt.slice(0, 10)}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Classes" value={exam.examClasses.length} />
        <StatCard title="Papers" value={papers.total} />
        <StatCard
          title="Scheduled"
          value={`${papers.scheduled}/${papers.total}`}
          hint={
            papers.unscheduled > 0
              ? `${papers.unscheduled} still undated`
              : "Routine complete"
          }
        />
        <StatCard title="Seat plan rooms" value={seatPlans} />
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "subjects" ? (
        <SubjectsTab examId={id} editable={shapeEditable} />
      ) : tab === "routine" ? (
        <RoutineTab examId={id} />
      ) : tab === "seat-plans" ? (
        <SeatPlansTab examId={id} />
      ) : (
        <AdmitCardsTab examId={id} classIds={exam.examClasses} />
      )}

      {statusOpen ? (
        <StatusDialog
          examId={id}
          current={exam.status}
          options={nextStatuses}
          onClose={() => setStatusOpen(false)}
          onDeleted={() => router.push("/admin/exams")}
        />
      ) : null}
    </main>
  );
}

/**
 * The status machine, as a dialog. `override` only waives the "mark
 * entry before the exam is over" guard — it can never skip a step.
 */
function StatusDialog({
  examId,
  current,
  options,
  onClose,
  onDeleted,
}: {
  examId: string;
  current: ExamStatus;
  options: ExamStatus[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ExamStatus | "">("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      examApi.changeStatus(examId, {
        status: status as ExamStatus,
        override,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (updated) => {
      toast.success(`Exam is now ${EXAM_STATUS_LABELS[updated.status]}.`);
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
      void qc.invalidateQueries({ queryKey: ["exams"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => examApi.remove(examId),
    onSuccess: () => {
      toast.success("Exam deleted.");
      void qc.invalidateQueries({ queryKey: ["exams"] });
      onDeleted();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Change status from {EXAM_STATUS_LABELS[current]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <Label>New status</Label>
          <Select
            value={status || undefined}
            onValueChange={(v) => setStatus(v as ExamStatus)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a status" />
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => (
                <SelectItem key={s} value={s}>
                  {EXAM_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {status === "MARK_ENTRY" ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={override}
              onCheckedChange={(v) => setOverride(v === true)}
            />
            <span>
              Open mark entry before the exam ends
              <span className="block text-xs text-muted-foreground">
                Needed only when the last paper has not been sat yet. Requires
                the <code>exam.status</code> permission and is audited.
              </span>
            </span>
          </label>
        ) : null}

        {status === "PUBLISHED" ? (
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Publishing freezes the grade scale onto the exam — later edits to
            the grading system can never restate these results.
          </p>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="status-reason">Reason (optional)</Label>
          <Textarea
            id="status-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </div>

        <DialogFooter className="sm:justify-between">
          {current === "DRAFT" ? (
            <Can permission="exam.manage">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Delete exam
              </Button>
            </Can>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={change.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!status || change.isPending}
              onClick={() => change.mutate()}
            >
              {change.isPending ? <Spinner className="mr-1 size-4" /> : null}
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
