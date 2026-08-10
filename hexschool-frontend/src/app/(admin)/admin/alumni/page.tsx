"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { alumniApi } from "@/lib/api/community";
import { DirectoryTab } from "./directory-tab";
import { ApprovalsTab } from "./approvals-tab";
import { EventsTab } from "./events-tab";
import { DonationsTab } from "./donations-tab";

/**
 * The alumni workspace (Module 28): the directory, the queue of people
 * claiming a place in it, the events they are invited to, and the money
 * they give.
 *
 * **The header counts the approval queue**, because a registration nobody
 * has looked at is a former student who thinks the school ignored them.
 */
const TABS = [
  ["directory", "Directory"],
  ["approvals", "Approvals"],
  ["events", "Events"],
  ["donations", "Donations"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function AlumniPage() {
  const [tab, setTab] = useState<TabKey>("directory");

  const pending = useQuery({
    queryKey: ["alumni", "pending-count"],
    queryFn: () => alumniApi.list({ status: "PENDING", limit: 1 }),
  });

  const waiting = pending.data?.meta?.total ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Alumni"
        description="Former students, the events they come back for, and what they give."
      >
        {waiting > 0 && (
          <Badge
            variant="secondary"
            className="cursor-pointer"
            onClick={() => setTab("approvals")}
          >
            {waiting} registration{waiting === 1 ? "" : "s"} to review
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

      {tab === "directory" && <DirectoryTab />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "events" && <EventsTab />}
      {tab === "donations" && <DonationsTab />}
    </main>
  );
}
