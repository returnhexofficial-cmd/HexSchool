"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import { ChartOfAccountsTab } from "./coa-tab";
import { VouchersTab } from "./vouchers-tab";
import { PostingMapTab } from "./posting-map-tab";
import { AccountingReportsTab } from "./reports-tab";
import { BudgetsTab } from "./budgets-tab";

/**
 * The Accounting & Finance workspace (Module 20). Five tabs follow how a
 * school's books are actually kept: name the accounts (Chart), record what
 * happened (Vouchers), tell the system where fee money belongs (Posting
 * map), read the statements (Reports), and plan against them (Budgets &
 * periods).
 */
const TABS = [
  ["vouchers", "Vouchers"],
  ["coa", "Chart of accounts"],
  ["reports", "Reports"],
  ["budgets", "Budgets & periods"],
  ["posting-map", "Posting map"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function AccountingPage() {
  const [tab, setTab] = useState<TabKey>("vouchers");
  const { selected: session } = useAcademicSession();

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Accounting & Finance"
        description="Double-entry books: the chart of accounts, vouchers, the ledgers and the three statements. Fee receipts post themselves."
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

      {tab === "vouchers" ? (
        <VouchersTab />
      ) : tab === "coa" ? (
        <ChartOfAccountsTab />
      ) : tab === "reports" ? (
        <AccountingReportsTab sessionId={session?.id ?? null} />
      ) : tab === "budgets" ? (
        <BudgetsTab sessionId={session?.id ?? null} />
      ) : (
        <PostingMapTab />
      )}
    </main>
  );
}
