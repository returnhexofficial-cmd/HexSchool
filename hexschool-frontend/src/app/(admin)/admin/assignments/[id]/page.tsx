"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  assignmentApi,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_TYPE_LABELS,
  dueRelative,
  formatDue,
  submissionApi,
  SUBMISSION_STATUS_LABELS,
  type SubmissionGridRow,
} from "@/lib/api/assignment";
import {
  ASSIGNMENT_STATUS_VARIANT,
  marksIssue,
  SUBMISSION_STATUS_VARIANT,
} from "@/lib/validations/assignment";

interface CellDraft {
  marks: string;
  feedback: string;
}

/**
 * Only the cells a teacher has actually touched live in state; everything
 * else reads through to the server's value. Seeding local state from the
 * query in an effect would both trigger a cascading render and let stale
 * text shadow a fresh figure after a save.
 */
function cellOf(
  edits: Record<string, CellDraft>,
  submission: { id: string; marks: string | null; feedback: string | null },
): CellDraft {
  return (
    edits[submission.id] ?? {
      marks: submission.marks ?? "",
      feedback: submission.feedback ?? "",
    }
  );
}

/**
 * One assignment: what was set, who handed it in, and the marking grid.
 *
 * The grid is a **staged edit with one save** (the M15 mark-grid pattern):
 * every cell is typed locally, invalid cells turn red immediately against
 * the assignment's own `fullMarks`, and Save posts the whole batch to the
 * bulk endpoint — which is all-or-nothing, so a single bad cell rejects
 * the batch and the server hands back every problem at once rather than
 * the first one N times.
 */
export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, CellDraft>>({});
  const [returning, setReturning] = useState<SubmissionGridRow | null>(null);
  const [confirm, setConfirm] = useState<"close" | "reopen" | "delete" | null>(
    null,
  );

  const assignment = useQuery({
    queryKey: ["assignment", id],
    queryFn: () => assignmentApi.detail(id),
  });

  const grid = useQuery({
    queryKey: ["assignment", id, "submissions"],
    queryFn: () => assignmentApi.submissions(id),
  });

  const fullMarks = assignment.data?.fullMarks
    ? Number(assignment.data.fullMarks)
    : null;

  const issues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [submissionId, draft] of Object.entries(edits)) {
      if (draft.marks.trim() === "") continue;
      const issue = marksIssue(Number(draft.marks), fullMarks);
      if (issue) map[submissionId] = issue;
    }
    return map;
  }, [edits, fullMarks]);

  const dirty = useMemo(() => {
    if (!grid.data) return [];
    return grid.data.rows
      .filter((row) => row.submission)
      .filter((row) => {
        const draft = edits[row.submission!.id];
        if (!draft) return false;
        return (
          draft.marks !== (row.submission!.marks ?? "") ||
          draft.feedback !== (row.submission!.feedback ?? "")
        );
      });
  }, [grid.data, edits]);

  const saveAll = useMutation({
    mutationFn: () =>
      assignmentApi.evaluateBulk(
        id,
        dirty.map((row) => {
          const draft = edits[row.submission!.id];
          return {
            submissionId: row.submission!.id,
            marks: draft.marks.trim() === "" ? null : Number(draft.marks),
            feedback: draft.feedback.trim() || undefined,
          };
        }),
      ),
    onSuccess: (result) => {
      toast.success(`Saved ${result.updated} evaluation(s).`);
      // Drop the local edits so the refetched server values show through.
      setEdits({});
      void qc.invalidateQueries({ queryKey: ["assignment", id] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const lifecycle = useMutation({
    mutationFn: (action: "publish" | "close" | "reopen") =>
      action === "publish"
        ? assignmentApi.publish(id)
        : action === "close"
          ? assignmentApi.close(id)
          : assignmentApi.reopen(id),
    onSuccess: (_data, action) => {
      toast.success(
        action === "publish"
          ? "Published — the section has been notified."
          : action === "close"
            ? "Closed. No more submissions, and evaluation is locked."
            : "Reopened.",
      );
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["assignment", id] });
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const remove = useMutation({
    mutationFn: () => assignmentApi.remove(id),
    onSuccess: () => {
      toast.success("Deleted.");
      window.location.href = "/admin/assignments";
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const returnWork = useMutation({
    mutationFn: (input: { submissionId: string; feedback: string }) =>
      submissionApi.returnForRevision(input.submissionId, input.feedback),
    onSuccess: () => {
      toast.success("Handed back for revision.");
      setReturning(null);
      void qc.invalidateQueries({ queryKey: ["assignment", id] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (assignment.isLoading) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (assignment.isError || !assignment.data) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void assignment.refetch()} />
      </main>
    );
  }

  const a = assignment.data;
  const stats = grid.data?.stats;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={a.title}
          description={`${ASSIGNMENT_TYPE_LABELS[a.type]} · ${a.section.class.name} ${a.section.name} · ${a.subject.name} · due ${formatDue(a.dueAt)} (${dueRelative(a.dueAt)})`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ASSIGNMENT_STATUS_VARIANT[a.status]}>
            {ASSIGNMENT_STATUS_LABELS[a.status]}
          </Badge>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/assignments">Back</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Can permission="assignment.publish">
          {a.status === "DRAFT" && (
            <Button
              size="sm"
              disabled={lifecycle.isPending}
              onClick={() => lifecycle.mutate("publish")}
            >
              Publish &amp; notify
            </Button>
          )}
          {a.status === "PUBLISHED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("close")}
            >
              Close
            </Button>
          )}
          {a.status === "CLOSED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("reopen")}
            >
              Reopen
            </Button>
          )}
        </Can>
        <Can permission="assignment.export">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void assignmentApi.downloadSubmissions(id)}
          >
            Download all (zip)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void assignmentApi.downloadMarks(id)}
          >
            Marks sheet (XLSX)
          </Button>
        </Can>
        <Can permission="assignment.manage">
          {a.status === "DRAFT" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirm("delete")}
            >
              Delete draft
            </Button>
          )}
        </Can>
      </div>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Submitted"
            value={`${stats.submitted} / ${stats.expected}`}
            hint={`${stats.submissionRate}% of the section`}
          />
          <StatCard title="Pending" value={String(stats.pending)} />
          <StatCard title="Late" value={String(stats.late)} />
          <StatCard
            title="Average mark"
            value={stats.averageMarks === null ? "—" : String(stats.averageMarks)}
            hint={
              stats.evaluated > 0
                ? `over ${stats.evaluated} evaluated`
                : "nothing marked yet"
            }
          />
        </div>
      )}

      {a.instructions && (
        <div className="rounded-md border p-4">
          <h3 className="mb-2 text-sm font-medium">Instructions</h3>
          {/* Sanitized on WRITE by the backend allow-list sanitizer (M19),
              so the stored row is already safe to render. */}
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: a.instructions }}
          />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Submissions</h2>
          <Can permission="assignment.evaluate">
            <Button
              size="sm"
              disabled={
                dirty.length === 0 ||
                Object.keys(issues).length > 0 ||
                saveAll.isPending
              }
              onClick={() => saveAll.mutate()}
            >
              {saveAll.isPending
                ? "Saving…"
                : `Save ${dirty.length || ""} evaluation${dirty.length === 1 ? "" : "s"}`.trim()}
            </Button>
          </Can>
        </div>

        {Object.keys(issues).length > 0 && (
          <p className="text-sm text-destructive">
            Fix the highlighted cells — the batch is saved all at once, so
            nothing is written while one is invalid.
          </p>
        )}

        {grid.isLoading ? (
          <LoadingBlock />
        ) : grid.isError ? (
          <ErrorState onRetry={() => void grid.refetch()} />
        ) : (grid.data?.rows.length ?? 0) === 0 ? (
          <EmptyState
            title="Nobody on this roster"
            description="Enroll students into the section and they will appear here."
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-28">
                    Marks{fullMarks !== null ? ` / ${fullMarks}` : ""}
                  </TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grid.data?.rows ?? []).map((row) => {
                  const submission = row.submission;
                  const draft = submission ? cellOf(edits, submission) : null;
                  const issue = submission ? issues[submission.id] : undefined;

                  return (
                    <TableRow key={row.enrollmentId}>
                      <TableCell>{row.rollNo}</TableCell>
                      <TableCell>
                        <div className="font-medium">{row.studentName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.studentUid}
                          {row.transferredOut && " · transferred out"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {submission ? (
                          <div className="space-y-1">
                            <Badge
                              variant={
                                SUBMISSION_STATUS_VARIANT[submission.status]
                              }
                            >
                              {SUBMISSION_STATUS_LABELS[submission.status]}
                            </Badge>
                            {submission.isLate && (
                              <div className="text-xs text-destructive">
                                late
                              </div>
                            )}
                            {submission.attempt > 1 && (
                              <div className="text-xs text-muted-foreground">
                                attempt {submission.attempt}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not submitted
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[18rem]">
                        {submission ? (
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">
                              {formatDue(submission.submittedAt)}
                            </div>
                            {submission.textAnswer && (
                              <p className="line-clamp-3 text-sm">
                                {submission.textAnswer}
                              </p>
                            )}
                            {submission.attachmentUrls.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {submission.attachmentUrls.length} file(s) —
                                download them together with the zip button
                                above
                              </div>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {submission ? (
                          <>
                            <Input
                              className={issue ? "border-destructive" : ""}
                              value={draft?.marks ?? ""}
                              disabled={fullMarks === null}
                              inputMode="decimal"
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [submission.id]: {
                                    marks: e.target.value,
                                    feedback: cellOf(prev, submission).feedback,
                                  },
                                }))
                              }
                            />
                            {issue && (
                              <p className="mt-1 text-xs text-destructive">
                                {issue}
                              </p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {submission ? (
                          <Textarea
                            rows={2}
                            value={draft?.feedback ?? ""}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [submission.id]: {
                                  marks: cellOf(prev, submission).marks,
                                  feedback: e.target.value,
                                },
                              }))
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {submission && (
                          <Can permission="assignment.evaluate">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReturning(row)}
                            >
                              Return
                            </Button>
                          </Can>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {returning?.submission && (
        <ReturnDialog
          studentName={returning.studentName}
          pending={returnWork.isPending}
          onClose={() => setReturning(null)}
          onSubmit={(feedback) =>
            returnWork.mutate({
              submissionId: returning.submission!.id,
              feedback,
            })
          }
        />
      )}

      <ConfirmDialog
        open={confirm === "close"}
        title="Close this assignment?"
        description="No more submissions will be accepted and evaluation locks. You can reopen it afterwards."
        confirmLabel="Close"
        onConfirm={() => lifecycle.mutate("close")}
        onOpenChange={(open) => !open && setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "reopen"}
        title="Reopen this assignment?"
        description="It goes back to published, so submissions and evaluation are possible again."
        confirmLabel="Reopen"
        onConfirm={() => lifecycle.mutate("reopen")}
        onOpenChange={(open) => !open && setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this draft?"
        description="Only a draft with no submissions can be deleted. Published work is closed, never erased."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutate()}
        onOpenChange={(open) => !open && setConfirm(null)}
      />
    </main>
  );
}

function ReturnDialog({
  studentName,
  pending,
  onClose,
  onSubmit,
}: {
  studentName: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const tooShort = feedback.trim().length < 2;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return {studentName}&rsquo;s work</DialogTitle>
          <DialogDescription>
            Say what needs revising. The mark is cleared, because the work
            being handed back is the work the mark described.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Feedback</Label>
          <Textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={tooShort || pending}
            onClick={() => onSubmit(feedback)}
          >
            {pending ? "Returning…" : "Return for revision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
