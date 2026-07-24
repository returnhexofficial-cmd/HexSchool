"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AttendanceHistory,
  formatBDT,
  PerformanceHistory,
  StudentLedger,
  StudentOverview,
} from "@/lib/api/portal";

export interface StudentFetchers {
  key: string;
  overview: () => Promise<StudentOverview>;
  attendance: () => Promise<AttendanceHistory>;
  results: () => Promise<PerformanceHistory>;
  dues: () => Promise<StudentLedger>;
}

const TABS = [
  ["overview", "Overview"],
  ["attendance", "Attendance"],
  ["results", "Results"],
  ["dues", "Dues"],
] as const;
type TabKey = (typeof TABS)[number][0];

export function StudentPanels({ fetchers }: { fetchers: StudentFetchers }) {
  const [tab, setTab] = useState<TabKey>("overview");
  return (
    <div className="space-y-5">
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
      {tab === "overview" ? (
        <OverviewPanel fetchers={fetchers} />
      ) : tab === "attendance" ? (
        <AttendancePanel fetchers={fetchers} />
      ) : tab === "results" ? (
        <ResultsPanel fetchers={fetchers} />
      ) : (
        <DuesPanel fetchers={fetchers} />
      )}
    </div>
  );
}

function OverviewPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "overview"],
    queryFn: fetchers.overview,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Attendance"
          value={d.attendance.percentage != null ? `${d.attendance.percentage}%` : "—"}
          hint={`${d.attendance.present} present · ${d.attendance.absent} absent`}
        />
        <StatCard
          title="Average GPA"
          value={d.averageGpa ? d.averageGpa.toFixed(2) : "—"}
          hint={d.result ? `Last: ${d.result.grade}` : "No results yet"}
        />
        <StatCard title="Outstanding dues" value={formatBDT(d.dues.outstanding)} />
        <StatCard
          title="Class"
          value={d.enrollment ? `${d.enrollment.className}` : "—"}
          hint={
            d.enrollment
              ? `${d.enrollment.sectionName} · Roll ${d.enrollment.rollNo}`
              : "Not enrolled"
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Today’s classes</h3>
          {d.todayPeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes scheduled today.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.todayPeriods.map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.subject}</span>
                    <span className="text-muted-foreground"> · {p.teacher}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {p.time}
                    {p.roomNo ? ` · ${p.roomNo}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Notices</h3>
          {d.notices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing new.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.notices.map((n) => (
                <li key={n.id}>
                  <span className="font-medium">{n.title}</span>
                  {n.pinned && <Badge variant="secondary" className="ml-2">Pinned</Badge>}
                  <p className="line-clamp-2 text-muted-foreground">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  PRESENT: "bg-green-500",
  LATE: "bg-amber-500",
  HALF_DAY: "bg-orange-400",
  ABSENT: "bg-red-500",
  LEAVE: "bg-blue-400",
  HOLIDAY: "bg-muted",
};

function AttendancePanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "attendance"],
    queryFn: fetchers.attendance,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Attendance %" value={`${d.percentage}%`} />
        <StatCard title="Marked days" value={String(d.markedDays)} />
        <StatCard title="Present" value={String(d.counts.PRESENT ?? 0)} />
      </div>
      <div className="rounded-md border p-4">
        <h3 className="mb-3 text-sm font-medium">Recent days</h3>
        <div className="flex flex-wrap gap-1">
          {d.items.slice(-60).map((it, i) => (
            <span
              key={i}
              title={`${it.date}: ${it.status}`}
              className={cn(
                "size-4 rounded-sm",
                STATUS_TONE[it.status] ?? "bg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "results"],
    queryFn: fetchers.results,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const published = d.items.filter((r) => r.publishedAt);
  if (published.length === 0) {
    return <EmptyState title="No published results" description="Results appear here once published." />;
  }
  return (
    <div className="space-y-3">
      <StatCard title="Average GPA" value={d.averageGpa.toFixed(2)} hint={`${d.examsPublished} exam(s)`} />
      {published.map((r) => (
        <div key={r.examId} className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="font-medium">{r.examName}</p>
            <p className="text-xs text-muted-foreground">
              {r.className} · Roll {r.rollNo}
              {r.meritPositionClass ? ` · Merit ${r.meritPositionClass}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold">GPA {r.gpa.toFixed(2)}</p>
            <Badge variant={r.status === "PASSED" ? "secondary" : "outline"}>
              {r.grade}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function DuesPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "dues"],
    queryFn: fetchers.dues,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Billed" value={formatBDT(d.totalBilled)} />
        <StatCard title="Paid" value={formatBDT(d.totalPaid)} />
        <StatCard title="Outstanding" value={formatBDT(d.outstanding)} />
      </div>
      {d.entries.length === 0 ? (
        <EmptyState title="No fee history" description="Invoices and payments appear here." />
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Description</th>
                <th className="p-2 text-right">Debit</th>
                <th className="p-2 text-right">Credit</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="whitespace-nowrap p-2 text-xs">{e.date}</td>
                  <td className="p-2">{e.description}</td>
                  <td className="p-2 text-right">{e.debit ? formatBDT(e.debit) : "—"}</td>
                  <td className="p-2 text-right">{e.credit ? formatBDT(e.credit) : "—"}</td>
                  <td className="p-2 text-right font-medium">{formatBDT(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
