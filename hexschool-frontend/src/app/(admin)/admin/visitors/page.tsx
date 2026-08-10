"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { visitorApi } from "@/lib/api/community";
import { DeskTab } from "./desk-tab";
import { AppointmentsTab } from "./appointments-tab";
import { VisitorRegisterTab } from "./register-tab";

/**
 * The visitor desk (Module 28).
 *
 * **The header carries the only number that matters minute to minute:**
 * how many people are inside. It is the question a fire drill, a
 * safeguarding review or a parent at the gate all reduce to, and it is why
 * the gate register exists at all.
 */
const TABS = [
  ["desk", "Desk"],
  ["appointments", "Appointments"],
  ["register", "Register"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function VisitorsPage() {
  const [tab, setTab] = useState<TabKey>("desk");

  const inside = useQuery({
    queryKey: ["visitors", "inside"],
    queryFn: () => visitorApi.inside(),
    // The board is a live answer, so it refreshes on its own rather than
    // waiting for somebody to reload the page.
    refetchInterval: 60_000,
  });

  const count = inside.data?.length ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Visitors & appointments"
        description="Who came, who they came to see, and who is still in the building."
      >
        <Badge
          variant={count > 0 ? "default" : "secondary"}
          className="cursor-pointer"
          onClick={() => setTab("desk")}
        >
          {count} in the building
        </Badge>
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

      {tab === "desk" && <DeskTab />}
      {tab === "appointments" && <AppointmentsTab />}
      {tab === "register" && <VisitorRegisterTab />}
    </main>
  );
}
