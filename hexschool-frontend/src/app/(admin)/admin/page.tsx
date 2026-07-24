"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { formatBDT, portalApi } from "@/lib/api/portal";
import { BarRow } from "./dashboard-charts";

/**
 * Admin / principal dashboard (Module 18) — the panel's landing page.
 * Stat cards + light charts over the cached `/dashboard/admin` aggregate,
 * gated by `dashboard.admin`; users without it (e.g. a plain accountant)
 * see a zero-state with quick links instead.
 */
export default function AdminHomePage() {
  const { can } = usePermissions();
  const canView = can("dashboard.admin");

  const q = useQuery({
    queryKey: ["dashboard", "admin"],
    queryFn: portalApi.adminDashboard,
    enabled: canView,
    staleTime: 60_000,
  });

  if (!canView) {
    return (
      <main className="flex-1 space-y-6 p-8">
        <PageHeader title="Dashboard" description="Your workspace." />
        <EmptyState
          title="Welcome"
          description="Use the sidebar to reach the areas you have access to."
        />
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Dashboard"
        description={q.data?.session ? q.data.session.name : "School overview"}
      />

      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        q.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Students"
                value={String(q.data.students.total)}
                hint="active"
              />
              <StatCard
                title="Today’s attendance"
                value={
                  q.data.todayAttendance != null
                    ? `${q.data.todayAttendance}%`
                    : "—"
                }
                hint={`Teachers ${q.data.teacherAttendance.present}/${q.data.teacherAttendance.total}`}
              />
              <StatCard
                title="Collected this month"
                value={formatBDT(q.data.feeCollection.month)}
                hint={`Today ${formatBDT(q.data.feeCollection.today)}`}
              />
              <StatCard
                title="Outstanding dues"
                value={formatBDT(q.data.feeCollection.duesTotal)}
                hint={`${q.data.pendingAdmissions} pending admissions`}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-md border p-4">
                <h3 className="mb-3 font-medium">Students by class</h3>
                {q.data.students.byClass.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No enrollments yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {q.data.students.byClass.map((c) => (
                      <BarRow
                        key={c.className}
                        label={c.className}
                        value={c.count}
                        max={Math.max(...q.data!.students.byClass.map((x) => x.count))}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                {q.data.resultStats && (
                  <div className="rounded-md border p-4">
                    <h3 className="mb-2 font-medium">Latest results</h3>
                    <p className="text-sm text-muted-foreground">
                      {q.data.resultStats.examName}
                    </p>
                    <div className="mt-2 flex gap-4 text-sm">
                      <span>
                        Pass rate{" "}
                        <strong>{q.data.resultStats.passRate}%</strong>
                      </span>
                      <span>
                        Avg GPA{" "}
                        <strong>{q.data.resultStats.averageGpa.toFixed(2)}</strong>
                      </span>
                      <span>
                        {q.data.resultStats.passed}/{q.data.resultStats.candidates}{" "}
                        passed
                      </span>
                    </div>
                  </div>
                )}
                <div className="rounded-md border p-4">
                  <h3 className="mb-2 font-medium">Upcoming events</h3>
                  {q.data.upcomingEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {q.data.upcomingEvents.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2">
                          <span>{e.title}</span>
                          <span className="text-muted-foreground">{e.date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-md border p-4">
              <h3 className="mb-2 font-medium">Recent notices</h3>
              {q.data.recentNotices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notices.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {q.data.recentNotices.map((n) => (
                    <li key={n.id}>
                      {n.pinned && <Badge variant="secondary" className="mr-2">Pinned</Badge>}
                      {n.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Can permission="report.view">
              <Link
                href="/admin/reports"
                className="inline-block text-sm text-primary underline"
              >
                Open the reports hub →
              </Link>
            </Can>
          </>
        )
      )}
    </main>
  );
}
