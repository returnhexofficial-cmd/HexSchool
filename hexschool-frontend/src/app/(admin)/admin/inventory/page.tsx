"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { inventoryReportsApi } from "@/lib/api/inventory";
import { CatalogTab } from "./catalog-tab";
import { PurchasesTab } from "./purchases-tab";
import { IssueDeskTab } from "./issue-desk-tab";
import { AssetsTab } from "./assets-tab";
import { InventoryReportsTab } from "./reports-tab";

/**
 * The store workspace (Module 24), in the order the office actually
 * works: what we stock (Catalogue), what arrived (Purchases), what went
 * out (Issue desk), what we own and who has it (Assets), and the reports
 * the head and the accountant read.
 *
 * The **low-stock badge sits in the header rather than inside a tab**, and
 * it is the same list the weekly job sends (roadmap §4/§5) — a store that
 * has run out of exam paper is not a thing to discover by clicking
 * through to a report.
 */
const TABS = [
  ["catalog", "Catalogue"],
  ["purchases", "Purchases"],
  ["issues", "Issue desk"],
  ["assets", "Asset register"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function InventoryPage() {
  const [tab, setTab] = useState<TabKey>("catalog");

  const lowStock = useQuery({
    queryKey: ["inventory-low-stock"],
    queryFn: inventoryReportsApi.lowStock,
  });

  const lowCount = lowStock.data?.rows.length ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Inventory & assets"
        description="What the school stocks, what it owns, who is holding it, and what it paid."
      >
        {lowCount > 0 && (
          <Badge
            variant="destructive"
            className="cursor-pointer"
            onClick={() => setTab("reports")}
          >
            {lowCount} item{lowCount === 1 ? "" : "s"} at or below reorder level
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

      {tab === "catalog" && <CatalogTab />}
      {tab === "purchases" && <PurchasesTab />}
      {tab === "issues" && <IssueDeskTab />}
      {tab === "assets" && <AssetsTab />}
      {tab === "reports" && <InventoryReportsTab />}
    </main>
  );
}
