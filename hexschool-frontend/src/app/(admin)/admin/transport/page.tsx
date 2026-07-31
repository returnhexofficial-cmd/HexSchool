"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { transportAlertsApi } from "@/lib/api/transport";
import { FleetTab } from "./fleet-tab";
import { RoutesTab } from "./routes-tab";
import { RidersTab } from "./riders-tab";
import { ExpensesTab } from "./expenses-tab";
import { TransportReportsTab } from "./reports-tab";

/**
 * The Transport workspace (Module 25), in the order the office actually
 * works: which buses run where (Routes), who is on them (Riders), what
 * the school owns and who drives it (Fleet), what it costs (Expenses),
 * and the reports the head reads.
 *
 * The **expiry badge sits in the header rather than inside a tab**: an
 * expired fitness certificate is the one thing in this module that must
 * not wait to be clicked on, and it is the same list the nightly job
 * sends (roadmap §4/§5).
 */
const TABS = [
  ["routes", "Routes & stops"],
  ["riders", "Riders"],
  ["fleet", "Vehicles & drivers"],
  ["expenses", "Expenses"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function TransportPage() {
  const [tab, setTab] = useState<TabKey>("routes");

  const alerts = useQuery({
    queryKey: ["transport-alerts"],
    queryFn: transportAlertsApi.list,
  });

  const alertCount = alerts.data?.total ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Transport"
        description="The buses, the routes they run, the children on them, and what it all costs."
      >
        {alertCount > 0 && (
          <Badge
            variant="destructive"
            className="cursor-pointer"
            onClick={() => setTab("fleet")}
          >
            {alertCount} document{alertCount === 1 ? "" : "s"} expired or
            expiring
          </Badge>
        )}
      </PageHeader>

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

      {tab === "routes" && <RoutesTab />}
      {tab === "riders" && <RidersTab />}
      {tab === "fleet" && <FleetTab />}
      {tab === "expenses" && <ExpensesTab />}
      {tab === "reports" && <TransportReportsTab />}
    </main>
  );
}
