"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { mealOffApi } from "@/lib/api/hostel";
import { HostelsTab } from "./hostels-tab";
import { BoardersTab } from "./boarders-tab";
import { MessTab } from "./mess-tab";
import { MealOffsTab } from "./meal-offs-tab";
import { HostelReportsTab } from "./reports-tab";

/**
 * The Hostel workspace (Module 26), in the order the office actually
 * works: which buildings there are and how full they are (Hostels), who
 * sleeps in them (Boarders), what the kitchen charges (Mess), who is away
 * (Meal-offs) and the reports the head reads.
 *
 * The **waiting-approvals badge sits in the header** rather than inside a
 * tab, for the reason a meal-off is time-sensitive at all: an undecided
 * request is a credit that will land on the wrong month's invoice, and it
 * stops being fixable the moment that invoice is raised.
 */
const TABS = [
  ["hostels", "Hostels & rooms"],
  ["boarders", "Boarders"],
  ["mess", "Mess plans"],
  ["mealoffs", "Meal-offs"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function HostelPage() {
  const [tab, setTab] = useState<TabKey>("hostels");

  const pending = useQuery({
    queryKey: ["meal-offs", "pending-count"],
    queryFn: () => mealOffApi.list({ status: "PENDING", limit: 1 }),
  });

  const waiting = pending.data?.meta?.total ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Hostel"
        description="The buildings, the beds in them, who sleeps where, what the kitchen charges, and what a family gets back when their child moves out."
      >
        {waiting > 0 && (
          <Badge
            variant="secondary"
            className="cursor-pointer"
            onClick={() => setTab("mealoffs")}
          >
            {waiting} meal-off request{waiting === 1 ? "" : "s"} waiting
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

      {tab === "hostels" && <HostelsTab />}
      {tab === "boarders" && <BoardersTab />}
      {tab === "mess" && <MessTab />}
      {tab === "mealoffs" && <MealOffsTab />}
      {tab === "reports" && <HostelReportsTab />}
    </main>
  );
}
