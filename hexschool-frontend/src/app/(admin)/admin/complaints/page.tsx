"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { ticketApi } from "@/lib/api/community";
import { InboxTab } from "./inbox-tab";
import { ComplaintReportsTab } from "./reports-tab";

/**
 * The complaints workspace (Module 28), in the order the office works:
 * the inbox itself, and the numbers a head asks for.
 *
 * **The header counts what is late, not what is open.** An open complaint
 * is normal — the office has a day or three depending on its priority. A
 * complaint past its SLA is the one nobody is dealing with, and that is
 * the number worth putting where somebody walks past it.
 */
const TABS = [
  ["inbox", "Inbox"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function ComplaintsPage() {
  const [tab, setTab] = useState<TabKey>("inbox");

  const summary = useQuery({
    queryKey: ["tickets", "sla-badge"],
    queryFn: () => ticketApi.summary(),
  });

  const late = summary.data?.breachedNow ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Complaints & feedback"
        description="What families and staff tell the school, who is dealing with it, and whether it got done."
      >
        {late > 0 && (
          <Badge
            variant="destructive"
            className="cursor-pointer"
            onClick={() => setTab("inbox")}
          >
            {late} past its response time
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

      {tab === "inbox" && <InboxTab />}
      {tab === "reports" && <ComplaintReportsTab />}
    </main>
  );
}
