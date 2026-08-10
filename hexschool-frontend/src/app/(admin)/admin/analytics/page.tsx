"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { BarRow, ColumnChart, Sparkline } from "@/components/shared/charts";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { analyticsApi } from "@/lib/api/analytics";
import { apiErrorMessage } from "@/lib/api/auth";
import { AttendanceHeatmap } from "./heatmap";

/**
 * The executive dashboard (roadmap M29 §5).
 *
 * One request rather than six: `GET /analytics/executive` composes the
 * panels server-side, each with its own cache entry, so the page is a
 * single round trip and each panel still has an endpoint to drill into.
 *
 * **Every panel served from a materialized view prints its own
 * staleness** (roadmap §8). A figure that quietly disagrees with the live
 * screen next to it destroys confidence in both, and the reader cannot
 * tell which is older unless the page says.
 */
export default function AnalyticsPage() {
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["analytics", "executive"],
    queryFn: () => analyticsApi.executive({}),
  });

  const refresh = useMutation({
    mutationFn: () => analyticsApi.refreshViews(),
    onSuccess: (views) => {
      const failed = views.filter((v) => !v.ok);
      if (failed.length > 0) {
        toast.error(`${failed.length} view(s) failed to rebuild`);
      } else {
        toast.success("Analytics views rebuilt");
      }
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const d = q.data;
  const money = (n: number) =>
    new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(n);

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Analytics"
        description="The whole school in one screen — enrollment, attendance, money, results and operations."
      >
        <div className="flex items-center gap-2">
          {d.session && <Badge variant="secondary">{d.session.name}</Badge>}
          <Can permission="analytics.refresh">
            <Button
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? "Rebuilding…" : "Rebuild views"}
            </Button>
          </Can>
        </div>
      </PageHeader>

      {/* ── the stat row ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="On the roll"
          value={String(d.enrollment.total)}
          hint={
            d.enrollment.trend?.changePct === null ||
            d.enrollment.trend === null
              ? undefined
              : `${d.enrollment.trend.changePct > 0 ? "+" : ""}${d.enrollment.trend.changePct}% on last month`
          }
        />
        <Can permission="analytics.finance">
          <Stat
            label="Fee realization (12 months)"
            value={
              d.finance.twelveMonth.rate === null
                ? "—"
                : `${d.finance.twelveMonth.rate}%`
            }
            hint={`${money(d.finance.twelveMonth.collected)} of ${money(d.finance.twelveMonth.billed)} BDT`}
          />
        </Can>
        <Stat
          label="Open complaints"
          value={String(d.operations.snapshot.openTickets)}
          hint={`${d.operations.snapshot.booksOverdue} books overdue`}
        />
        <Stat
          label="Website (30 days)"
          value={
            d.website ? String(d.website.totals.pageViews) : "Not tracked"
          }
          hint={
            d.website?.today
              ? `${d.website.today.pageViews} views today`
              : undefined
          }
        />
      </div>

      {/* ── enrollment ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Enrollment, this year against last</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Sparkline
            data={d.enrollment.series.map((p) => ({
              label: p.key.slice(5),
              value: p.current,
            }))}
          />
          <div className="space-y-1.5">
            {d.enrollment.byClass.slice(0, 8).map((c) => (
              <BarRow
                key={c.className}
                label={c.className}
                value={c.count}
                max={Math.max(1, ...d.enrollment.byClass.map((x) => x.count))}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Counted from the enrollment date to the session end, not from the
            current status — a month whose baseline was zero shows no
            percentage rather than infinite growth.
          </p>
        </CardContent>
      </Card>

      {/* ── attendance heatmap ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance by section and month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AttendanceHeatmap data={d.attendance.heatmap} />
          <p className="text-xs text-muted-foreground">
            {d.attendance.freshness}
          </p>
        </CardContent>
      </Card>

      {/* ── money ────────────────────────────────────────────────────── */}
      <Can permission="analytics.finance">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Collected by month</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColumnChart
                data={d.finance.monthly.map((m) => ({
                  label: m.month.slice(5),
                  value: m.collected,
                }))}
                format={(n) => `${money(n)} BDT`}
              />
              <p className="text-xs text-muted-foreground">
                {d.finance.freshness}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dues by age</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.finance.aging.map((bucket) => (
                <BarRow
                  key={bucket.label}
                  label={bucket.label}
                  value={bucket.amount}
                  max={Math.max(1, ...d.finance.aging.map((b) => b.amount))}
                  format={(n) => money(n)}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                {d.finance.aging.reduce((s, b) => s + b.count, 0)} unpaid
                invoices · {money(d.finance.twelveMonth.outstanding)} BDT
                outstanding
              </p>
            </CardContent>
          </Card>
        </div>
      </Can>

      {/* ── results ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Results over time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {d.results.exams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published results yet.
            </p>
          ) : (
            <>
              <Sparkline
                data={d.results.exams.map((e) => ({
                  label: e.examDate.slice(2, 7),
                  value: e.passRate,
                }))}
                format={(n) => `${n}%`}
              />
              <div className="space-y-1.5">
                {d.results.exams.slice(-6).map((e) => (
                  <div
                    key={e.examId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate">{e.examName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {e.candidates} sat · {e.passRate ?? "—"}% passed · GPA{" "}
                      {e.avgGpa ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">{d.results.freshness}</p>
        </CardContent>
      </Card>

      {/* ── operations ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Books on loan" value={String(d.operations.snapshot.booksOnLoan)} />
            <Stat label="Overdue" value={String(d.operations.snapshot.booksOverdue)} />
            <Stat label="Bus riders" value={String(d.operations.snapshot.transportRiders)} />
            <Stat label="Boarders" value={String(d.operations.snapshot.hostelResidents)} />
            <Stat label="Low stock" value={String(d.operations.snapshot.lowStockItems)} />
            <Stat
              label="Teachers on leave"
              value={String(d.operations.staff?.onLeaveToday ?? 0)}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            SMS spend over 30 days: {d.operations.smsSpend} BDT
          </p>
        </CardContent>
      </Card>

      {/* ── website ──────────────────────────────────────────────────── */}
      {d.website && (
        <Can permission="analytics.website">
          <Card>
            <CardHeader>
              <CardTitle>Public website</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Sparkline
                data={d.website.days.map((day) => ({
                  label: day.date.slice(5),
                  value: day.pageViews,
                }))}
              />
              <div className="space-y-1.5">
                {d.website.topPages.slice(0, 6).map((p) => (
                  <BarRow
                    key={p.path}
                    label={p.path}
                    value={p.views}
                    max={Math.max(1, ...d.website!.topPages.map((x) => x.views))}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Unique visitors are counted anonymously and cannot be summed
                across days.
              </p>
            </CardContent>
          </Card>
        </Can>
      )}

      <p className="text-xs text-muted-foreground">
        Computed {new Date(d.computedAt).toLocaleString()}.
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
