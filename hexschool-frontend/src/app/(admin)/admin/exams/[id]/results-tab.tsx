"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  resultApi,
  unlockedPapersFromError,
  type ResultRow,
} from "@/lib/api/result";
import {
  RESULT_STATUS_LABELS,
  RESULT_STATUS_VARIANT,
  RUN_STATUS_LABELS,
} from "@/lib/validations/result";

/**
 * Processing, the results table and publication (roadmap M15 §5).
 *
 * Two things drive the layout. A processing run is asynchronous, so the
 * page polls while one is in flight and shows the issue list ("12
 * students missing Math marks") underneath. And **publication is not the
 * exam's status** — the exam can never rewind past PUBLISHED, so
 * visibility is the active publication version, which is why unpublish
 * and republish live here rather than on the status dialog.
 */
export function ResultsTab({ examId }: { examId: string }) {
  const qc = useQueryClient();
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [withholding, setWithholding] = useState<ResultRow | null>(null);
  const [unlocked, setUnlocked] = useState<
    Array<{ label: string; status: string }>
  >([]);

  const [channels, setChannels] = useState({
    portal: true,
    website: false,
    sms: false,
  });
  const [note, setNote] = useState("");
  const [unpublishReason, setUnpublishReason] = useState("");
  const [withholdReason, setWithholdReason] = useState("");

  const status = useQuery({
    queryKey: ["process-status", examId],
    queryFn: () => resultApi.processStatus(examId),
    // Poll only while a run is actually moving.
    refetchInterval: (query) => {
      const state = query.state.data?.run?.status;
      return state === "QUEUED" || state === "RUNNING" ? 1500 : false;
    },
  });

  const results = useQuery({
    queryKey: ["results", examId],
    queryFn: () => resultApi.list(examId),
  });

  const publications = useQuery({
    queryKey: ["publications", examId],
    queryFn: () => resultApi.publications(examId),
  });

  const process = useMutation({
    mutationFn: (override: boolean) => resultApi.process(examId, { override }),
    onSuccess: () => {
      setUnlocked([]);
      toast.success("Processing started");
      void qc.invalidateQueries({ queryKey: ["process-status", examId] });
      void qc.invalidateQueries({ queryKey: ["results", examId] });
    },
    onError: (error) => {
      setUnlocked(unlockedPapersFromError(error));
      toast.error(apiErrorMessage(error));
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      resultApi.publish(examId, { channels, note: note || undefined }),
    onSuccess: (summary) => {
      setPublishOpen(false);
      setNote("");
      toast.success(
        `Published version ${summary.publication.version} — ${summary.results} result(s)` +
          (summary.smsQueued > 0 ? `, ${summary.smsQueued} SMS queued` : ""),
      );
      void qc.invalidateQueries({ queryKey: ["publications", examId] });
      void qc.invalidateQueries({ queryKey: ["results", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const unpublish = useMutation({
    mutationFn: () => resultApi.unpublish(examId, unpublishReason),
    onSuccess: () => {
      setUnpublishOpen(false);
      setUnpublishReason("");
      toast.success("Results hidden from the portal and public search");
      void qc.invalidateQueries({ queryKey: ["publications", examId] });
      void qc.invalidateQueries({ queryKey: ["results", examId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const withhold = useMutation({
    mutationFn: (input: { id: string; withheld: boolean; reason?: string }) =>
      resultApi.withhold(input.id, {
        withheld: input.withheld,
        reason: input.reason,
      }),
    onSuccess: () => {
      setWithholding(null);
      setWithholdReason("");
      toast.success("Result updated");
      void qc.invalidateQueries({ queryKey: ["results", examId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (status.isLoading) return <LoadingBlock />;

  const run = status.data?.run ?? null;
  const running = run?.status === "QUEUED" || run?.status === "RUNNING";
  const rows = results.data?.results ?? [];
  const published = publications.data?.published ?? false;
  const counts = Object.fromEntries(
    (status.data?.byStatus ?? []).map((r) => [r.status, r.count]),
  );

  return (
    <div className="space-y-5">
      {/* ── processing ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Results" value={String(status.data?.results ?? 0)} />
        <StatCard title="Passed" value={String(counts.PASSED ?? 0)} />
        <StatCard title="Failed" value={String(counts.FAILED ?? 0)} />
        <StatCard title="Incomplete" value={String(counts.INCOMPLETE ?? 0)} />
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h3 className="font-medium">Result processing</h3>
            <p className="text-muted-foreground text-sm">
              {run
                ? `Last run: ${RUN_STATUS_LABELS[run.status]} — ${run.processed}/${run.total} candidates`
                : "Not processed yet"}
            </p>
          </div>
          <Can permission="result.process">
            <Button
              onClick={() => process.mutate(false)}
              disabled={process.isPending || running}
            >
              {(process.isPending || running) && (
                <Spinner className="mr-2 h-4 w-4" />
              )}
              {running ? "Processing…" : "Process results"}
            </Button>
          </Can>
        </div>

        {running && (
          <div className="bg-muted h-2 w-full overflow-hidden rounded">
            <div
              className="bg-primary h-full transition-all"
              style={{
                width: `${run.total > 0 ? Math.round((run.processed / run.total) * 100) : 5}%`,
              }}
            />
          </div>
        )}

        {status.data?.stale && (
          <p className="text-destructive text-sm">
            Marks have changed since the last run — reprocess before
            publishing, or the published numbers will not match the marks on
            file.
          </p>
        )}

        {run?.status === "FAILED" && run.error && (
          <p className="text-destructive text-sm">Run failed: {run.error}</p>
        )}

        {/* The roadmap's "12 students missing Math marks" list. */}
        {run?.issues && run.issues.length > 0 && (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-sm font-medium">
              {run.issues.length} candidate(s) need attention
            </p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              {run.issues.slice(0, 10).map((issue) => (
                <li key={issue.enrollmentId}>
                  Roll {issue.rollNo} — {issue.studentName}: {issue.detail}
                </li>
              ))}
              {run.issues.length > 10 && (
                <li>…and {run.issues.length - 10} more</li>
              )}
            </ul>
          </div>
        )}

        {unlocked.length > 0 && (
          <div className="border-destructive/40 rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">
              {unlocked.length} paper(s) are not locked
            </p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              {unlocked.map((paper) => (
                <li key={paper.label}>
                  {paper.label} — {paper.status}
                </li>
              ))}
            </ul>
            <Can permission="result.process.override">
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={process.isPending}
                onClick={() => process.mutate(true)}
              >
                Process anyway (marks incomplete)
              </Button>
            </Can>
          </div>
        )}
      </div>

      {/* ── publication ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
        <div className="flex-1">
          <h3 className="font-medium">Publication</h3>
          <p className="text-muted-foreground text-sm">
            {published
              ? `Live — version ${publications.data?.active?.version}`
              : "Not visible to students or the website"}
          </p>
        </div>
        <Can permission="result.export">
          <Button
            variant="outline"
            onClick={() => void resultApi.downloadTabulation(examId, "xlsx")}
            disabled={rows.length === 0}
          >
            Tabulation (XLSX)
          </Button>
          <Button
            variant="outline"
            onClick={() => void resultApi.downloadReportCards(examId)}
            disabled={rows.length === 0}
          >
            Report cards
          </Button>
        </Can>
        <Can permission="result.publish">
          {published ? (
            <>
              <Button variant="outline" onClick={() => setPublishOpen(true)}>
                Re-issue
              </Button>
              <Button
                variant="destructive"
                onClick={() => setUnpublishOpen(true)}
              >
                Unpublish
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setPublishOpen(true)}
              disabled={rows.length === 0}
            >
              Publish
            </Button>
          )}
        </Can>
      </div>

      {/* ── results table ──────────────────────────────────────────── */}
      {results.isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Lock every paper's marks, then run processing."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Roll</th>
                <th className="px-3 py-2 text-left font-medium">Student</th>
                <th className="px-3 py-2 text-left font-medium">Class</th>
                <th className="px-3 py-2 text-right font-medium">Marks</th>
                <th className="px-3 py-2 text-right font-medium">GPA</th>
                <th className="px-3 py-2 text-left font-medium">Grade</th>
                <th className="px-3 py-2 text-right font-medium">Merit</th>
                <th className="px-3 py-2 text-left font-medium">Result</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-1.5">{row.enrollment.rollNo}</td>
                  <td className="px-3 py-1.5">
                    {row.enrollment.student.firstName}{" "}
                    {row.enrollment.student.lastName}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.enrollment.class.name} — {row.enrollment.section.name}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {Number(row.obtainedMarks)}/{Number(row.totalMarks)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">
                    {Number(row.gpa).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5">{row.grade}</td>
                  <td className="px-3 py-1.5 text-right">
                    {row.meritPositionClass === null
                      ? "—"
                      : `#${row.meritPositionClass}`}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={RESULT_STATUS_VARIANT[row.status]}>
                      {RESULT_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.withheldReason && (
                      <div className="text-muted-foreground text-xs">
                        {row.withheldReason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Can permission="result.withhold">
                      {row.status === "WITHHELD" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            withhold.mutate({ id: row.id, withheld: false })
                          }
                        >
                          Release
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setWithholding(row)}
                        >
                          Withhold
                        </Button>
                      )}
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── dialogs ────────────────────────────────────────────────── */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {published ? "Re-issue results" : "Publish results"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Choose where the result appears. Withheld results are never
              sent, whatever is ticked here.
            </p>
            {(
              [
                ["portal", "Student & parent portal"],
                ["website", "Public website result search"],
                ["sms", "SMS to primary guardians (GPA + merit)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`channel-${key}`}
                  checked={channels[key]}
                  onCheckedChange={(checked) =>
                    setChannels((c) => ({ ...c, [key]: checked === true }))
                  }
                />
                <Label htmlFor={`channel-${key}`}>{label}</Label>
              </div>
            ))}
            {published && (
              <div>
                <Label htmlFor="publish-note">Changelog note</Label>
                <Textarea
                  id="publish-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why is this version being re-issued?"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              {publish.isPending && <Spinner className="mr-2 h-4 w-4" />}
              {published ? "Re-issue" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unpublishOpen} onOpenChange={setUnpublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish results</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              The processed results are kept exactly as they are — this only
              hides them from the portal and the public search.
            </p>
            <div>
              <Label htmlFor="unpublish-reason">Reason</Label>
              <Input
                id="unpublish-reason"
                value={unpublishReason}
                onChange={(e) => setUnpublishReason(e.target.value)}
                placeholder="Re-check pending"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnpublishOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={unpublish.isPending || unpublishReason.trim().length < 3}
              onClick={() => unpublish.mutate()}
            >
              {unpublish.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={withholding !== null}
        onOpenChange={(open) => !open && setWithholding(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withhold this result</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {withholding?.enrollment.student.firstName}{" "}
              {withholding?.enrollment.student.lastName} (roll{" "}
              {withholding?.enrollment.rollNo}) will disappear from the portal
              and the public search. A later processing run will not release
              it.
            </p>
            <div>
              <Label htmlFor="withhold-reason">Reason</Label>
              <Input
                id="withhold-reason"
                value={withholdReason}
                onChange={(e) => setWithholdReason(e.target.value)}
                placeholder="Outstanding dues"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithholding(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={withhold.isPending || withholdReason.trim().length < 3}
              onClick={() =>
                withholding &&
                withhold.mutate({
                  id: withholding.id,
                  withheld: true,
                  reason: withholdReason,
                })
              }
            >
              {withhold.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Withhold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
