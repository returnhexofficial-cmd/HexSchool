"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { CatalogTab } from "./catalog-tab";
import { MastersTab } from "./masters-tab";
import { MembersTab } from "./members-tab";
import { CirculationTab } from "./circulation-tab";
import { ReportsTab } from "./reports-tab";

/**
 * The Library workspace (Module 23), in the order a library desk's day
 * actually runs: what is out and what is coming back (Circulation), what
 * the school owns (Catalogue), who may borrow it (Members), the shelf
 * masters, and the reports the head reads.
 *
 * The **desk itself is a separate page** (`/admin/library/circulation`),
 * not a tab: it is keyboard-and-scanner-first and wants the whole screen
 * and the focus, which is exactly what a tab strip takes away.
 */
const TABS = [
  ["circulation", "Loans & fines"],
  ["catalog", "Catalogue"],
  ["members", "Members"],
  ["masters", "Categories, authors, publishers"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function LibraryPage() {
  const [tab, setTab] = useState<TabKey>("circulation");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Library"
        description="The catalogue, the copies on the shelves, the cards, and everything currently in somebody's bag."
      >
        <Can permission="library.issue">
          <Button asChild>
            <Link href="/admin/library/circulation">Open the desk</Link>
          </Button>
        </Can>
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

      {tab === "circulation" && <CirculationTab />}
      {tab === "catalog" && <CatalogTab />}
      {tab === "members" && <MembersTab />}
      {tab === "masters" && <MastersTab />}
      {tab === "reports" && <ReportsTab />}
    </main>
  );
}
