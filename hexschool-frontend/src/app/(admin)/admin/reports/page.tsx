"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { portalApi } from "@/lib/api/portal";

/**
 * Reports hub (Module 18) — a searchable catalog of every report the user
 * may run, served by `GET /reports` (already filtered to their
 * permissions). Each card names where the report lives, its parameters and
 * export formats; the actual run/export uses the module's own page/endpoint.
 */
export default function ReportsHubPage() {
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["reports"], queryFn: portalApi.reports });

  const grouped = useMemo(() => {
    const rows = (q.data ?? []).filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.module.toLowerCase().includes(search.toLowerCase()),
    );
    const byModule = new Map<string, typeof rows>();
    for (const r of rows) {
      byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);
    }
    return [...byModule.entries()];
  }, [q.data, search]);

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Reports"
        description="Every report you can run, in one place."
      />

      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="You don’t have permission to run any reports yet."
        />
      ) : (
        <>
          <Input
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          {grouped.map(([module, rows]) => (
            <section key={module} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {module}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <div key={r.code} className="rounded-md border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">{r.name}</h3>
                      <div className="flex gap-1">
                        {r.formats.map((f) => (
                          <Badge key={f} variant="outline" className="uppercase">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.description}
                    </p>
                    {r.params.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Params: {r.params.map((p) => p.label).join(", ")}
                      </p>
                    )}
                    <code className="mt-2 block truncate text-xs text-muted-foreground">
                      {r.endpoint}
                    </code>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
