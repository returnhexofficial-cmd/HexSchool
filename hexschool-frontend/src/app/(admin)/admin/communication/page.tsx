"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import { TemplatesTab } from "./templates-tab";
import { ComposeTab } from "./compose-tab";
import { NoticesTab } from "./notices-tab";
import { LogTab } from "./log-tab";
import { CreditsTab } from "./credits-tab";

/**
 * The Communication workspace (Module 17). Five tabs: author the school's
 * voice (Templates), blast an audience (Compose), post the notice board
 * (Notices), audit what went out (Log) and top up the SMS balance
 * (Credits). Compose resolves its roster audiences in the header session.
 */
const TABS = [
  ["compose", "Compose"],
  ["notices", "Notices"],
  ["templates", "Templates"],
  ["log", "Delivery log"],
  ["credits", "SMS credits"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function CommunicationPage() {
  const [tab, setTab] = useState<TabKey>("compose");
  const { selected: session } = useAcademicSession();

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Communication"
        description="SMS, email and in-app notifications, notices and SMS credits."
      />

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

      {tab === "compose" ? (
        <ComposeTab sessionId={session?.id ?? null} />
      ) : tab === "notices" ? (
        <NoticesTab />
      ) : tab === "templates" ? (
        <TemplatesTab />
      ) : tab === "log" ? (
        <LogTab />
      ) : (
        <CreditsTab />
      )}
    </main>
  );
}
