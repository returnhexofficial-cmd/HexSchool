"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { analyticsApi, type ReportDefinition } from "@/lib/api/analytics";
import { RunReportDialog } from "./run-report-dialog";

/**
 * Reports hub v2 (Module 29) — the M18 catalog with a runner attached.
 *
 * `GET /reports` is already filtered to what the caller may run, so the
 * hub never offers something the API would then refuse. A report the
 * engine cannot generate as a file keeps its deep link and simply has no
 * Run button, rather than showing one that queues a job that can only
 * fail.
 */
export function ReportCatalogTab() {
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<ReportDefinition | null>(null);

  const q = useQuery({
    queryKey: ["reports"],
    queryFn: analyticsApi.reports,
  });

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (q.data ?? []).filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.module.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle),
    );
    const byModule = new Map<string, ReportDefinition[]>();
    for (const r of rows) {
      byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [q.data, search]);

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data || q.data.length === 0) {
    return (
      <EmptyState
        title="No reports available"
        description="You don’t have permission to run any reports yet."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Input
        placeholder="Search reports…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {grouped.length === 0 && (
        <EmptyState
          title="Nothing matches"
          description="Try a different search."
        />
      )}

      {grouped.map(([module, rows]) => (
        <section key={module} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {module}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <article
                key={r.code}
                className="flex flex-col gap-2 rounded-md border p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{r.name}</h3>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {r.formats.map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{r.description}</p>

                {r.freshness && (
                  <p className="text-xs text-muted-foreground">{r.freshness}</p>
                )}
                {r.columnsWillBeWithheld && (
                  <p className="text-xs text-muted-foreground">
                    Some columns will be withheld from your copy.
                  </p>
                )}

                <div className="mt-auto flex items-center gap-2 pt-2">
                  {r.runnable ? (
                    <Button size="sm" onClick={() => setRunning(r)}>
                      Run
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Opens in its own module
                    </span>
                  )}
                  {r.endpoint && !r.endpoint.includes(":") && (
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={moduleHref(r)}>Open</Link>
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <RunReportDialog
        report={running}
        open={running !== null}
        onOpenChange={(open) => !open && setRunning(null)}
      />
    </div>
  );
}

/**
 * Where a report's own module page lives.
 *
 * Derived from the report code's prefix rather than stored, because the
 * admin route and the API endpoint are different things and pretending
 * otherwise (linking straight to `/api/...`) would send the reader to a
 * JSON blob.
 */
function moduleHref(report: ReportDefinition): string {
  const [prefix] = report.code.split(".");
  const routes: Record<string, string> = {
    attendance: "/admin/attendance",
    result: "/admin/results",
    fee: "/admin/fees",
    accounting: "/admin/accounting",
    payroll: "/admin/hr",
    library: "/admin/library",
    transport: "/admin/transport",
    inventory: "/admin/inventory",
    hostel: "/admin/hostel",
    certificate: "/admin/certificates",
    ticket: "/admin/complaints",
    visitor: "/admin/visitors",
    donation: "/admin/alumni",
    alumni: "/admin/alumni",
    communication: "/admin/communication",
    analytics: "/admin/analytics",
  };
  return routes[prefix] ?? "/admin/reports";
}
