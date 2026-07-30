"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { AssignmentsTab } from "./assignments-tab";
import { MaterialsTab } from "./materials-tab";

/**
 * The Assignments & Homework workspace (Module 22). Two tabs, in the order
 * a teacher's week actually runs: set and mark the work (Assignments),
 * then keep the class-notes shelf current (Materials).
 *
 * This is the first admin area whose primary user is the **Teacher** role
 * rather than the office — the list defaults to the caller's own
 * section-subjects, and the backend scopes it the same way whether or not
 * the UI asks.
 */
const TABS = [
  ["assignments", "Assignments"],
  ["materials", "Learning materials"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function AssignmentsPage() {
  const [tab, setTab] = useState<TabKey>("assignments");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Assignments & Homework"
        description="Set work for your sections, review what came in, mark it with feedback — and keep the class notes and slides beside it."
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

      {tab === "assignments" ? <AssignmentsTab /> : <MaterialsTab />}
    </main>
  );
}
