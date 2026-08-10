"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReportCatalogTab } from "./catalog-tab";
import { ExportCentreTab } from "./export-centre-tab";
import { SchedulesTab } from "./schedules-tab";

/**
 * The reports workspace (Module 29), in the order somebody uses it: find
 * the report, collect the file, and set the ones you want without asking.
 *
 * This replaces M18's read-only hub at the same route. The catalog is
 * still `GET /reports` and still self-filters to what the caller may run —
 * what M29 adds is that pressing Run now does something.
 */
const TABS = [
  ["catalog", "Catalog"],
  ["exports", "Export centre"],
  ["schedules", "Schedules"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>("catalog");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Reports"
        description="Every report you can run, the files you have generated, and the ones that arrive on their own."
      />

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            className={cn(
              "rounded-none border-b-2 border-transparent",
              tab === key && "border-primary text-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "catalog" && <ReportCatalogTab />}
      {tab === "exports" && <ExportCentreTab />}
      {tab === "schedules" && <SchedulesTab />}
    </main>
  );
}
