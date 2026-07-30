"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { EmployeesTab } from "./employees-tab";
import { LeaveTab } from "./leave-tab";
import { StructuresTab } from "./structures-tab";
import { PayrollTab } from "./payroll-tab";
import { HrReportsTab } from "./reports-tab";

/**
 * The HR & Payroll workspace (Module 21). Five tabs in the order a school
 * actually uses them: see the workforce as one list (Employees), work the
 * leave inbox (Leave), define what people are paid (Salary scales), run
 * the month (Payroll), and read what it cost (Reports).
 *
 * The Employees tab is first on purpose — it is the thing M08 and M07
 * deliberately kept apart, and the whole point of this module is that HR
 * finally looks at teachers and staff together.
 */
const TABS = [
  ["employees", "Employees"],
  ["leave", "Leave"],
  ["structures", "Salary scales"],
  ["payroll", "Payroll"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function HrPage() {
  const [tab, setTab] = useState<TabKey>("employees");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="HR & Payroll"
        description="Teachers and staff as one workforce: leave with real balances, salary scales, the monthly payroll run, payslips and the provident fund."
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

      {tab === "employees" ? (
        <EmployeesTab />
      ) : tab === "leave" ? (
        <LeaveTab />
      ) : tab === "structures" ? (
        <StructuresTab />
      ) : tab === "payroll" ? (
        <PayrollTab />
      ) : (
        <HrReportsTab />
      )}
    </main>
  );
}
