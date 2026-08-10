"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  ticketApi,
} from "@/lib/api/community";

/**
 * Roadmap §4's "reports (by category/status/avg resolution time)".
 *
 * **The banner at the top is the honest part.** A reader without
 * `ticket.sensitive.view` gets a report over the complaints they may read,
 * which is correct — and the page says so, because a "42 complaints this
 * term" figure that quietly omits the ones about staff is exactly the kind
 * of number that ends up in a governors' pack meaning something other than
 * what it says. That is the M27 lesson (a clearance source that failed
 * looking identical to one that said "nothing owed") applied to a report.
 */
export function ComplaintReportsTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const report = useQuery({
    queryKey: ["tickets", "summary", params],
    queryFn: () => ticketApi.summary(params),
  });

  if (report.isLoading) return <LoadingBlock />;
  if (report.isError || !report.data) {
    return <ErrorState onRetry={() => void report.refetch()} />;
  }

  const data = report.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Can permission="ticket.export">
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ticketApi.downloadSummary(params)}
            >
              Summary (XLSX)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ticketApi.downloadRegister(params)}
            >
              Register (XLSX)
            </Button>
          </div>
        </Can>
      </div>

      {data.excludesSensitive && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          These figures <strong>exclude restricted complaints</strong> — those
          naming a member of staff. You do not hold the permission to read
          them, so they are not counted here either. Ask a senior member of
          staff for the whole picture.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Raised" value={String(data.total)} />
        <StatCard title="Resolved" value={String(data.resolution.resolved)} />
        <StatCard
          title="Average resolution"
          value={`${data.resolution.avgResolutionHours} h`}
        />
        <StatCard
          title="Past response time now"
          value={String(data.breachedNow)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="First response"
          value={`${data.resolution.avgFirstResponseHours} h`}
        />
        <StatCard
          title="Within SLA"
          value={`${data.resolution.slaCompliancePercent}%`}
        />
        <StatCard title="Rated" value={String(data.satisfaction.rated)} />
        <StatCard
          title="Average rating"
          value={
            data.satisfaction.rated === 0
              ? "—"
              : `${data.satisfaction.average} / 5`
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          title="By category"
          rows={data.byCategory.map((row) => ({
            label: TICKET_CATEGORY_LABELS[row.category],
            count: row.count,
          }))}
          total={data.total}
        />
        <Breakdown
          title="By status"
          rows={data.byStatus.map((row) => ({
            label: TICKET_STATUS_LABELS[row.status],
            count: row.count,
          }))}
          total={data.total}
        />
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  total: number;
}) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{title}</p>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this window.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => (
            <div key={row.label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{row.label}</span>
                <span className="text-muted-foreground">{row.count}</span>
              </div>
              <div className="h-1.5 w-full rounded bg-muted">
                <div
                  className="h-1.5 rounded bg-primary"
                  style={{
                    width: `${total === 0 ? 0 : (row.count / total) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
