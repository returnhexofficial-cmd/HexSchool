"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import { FeeSetupTab } from "./setup-tab";
import { InvoicesTab } from "./invoices-tab";
import { CollectionTab } from "./collection-tab";
import { FeeReportsTab } from "./reports-tab";

/**
 * The Fees & Payments workspace (Module 16). Four tabs follow the money's
 * life: price the heads (Setup), raise the bills (Invoices), take the
 * money (Collection desk), and read what happened (Reports). Everything
 * is scoped to the session the header switcher shows.
 */
const TABS = [
  ["setup", "Setup"],
  ["invoices", "Invoices"],
  ["collection", "Collection desk"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function FeesPage() {
  const [tab, setTab] = useState<TabKey>("invoices");
  const { selected: session } = useAcademicSession();

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Fees & Payments"
        description={
          session
            ? `Fee heads, invoicing, collection and reports for ${session.name}.`
            : "Fee heads, invoicing, collection and reports."
        }
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

      {tab === "setup" ? (
        <FeeSetupTab sessionId={session?.id ?? null} />
      ) : tab === "invoices" ? (
        <InvoicesTab sessionId={session?.id ?? null} />
      ) : tab === "collection" ? (
        <CollectionTab sessionId={session?.id ?? null} />
      ) : (
        <FeeReportsTab sessionId={session?.id ?? null} />
      )}
    </main>
  );
}
