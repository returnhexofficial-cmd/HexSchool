"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { certificateApi } from "@/lib/api/documents";
import { RegisterTab } from "./register-tab";
import { IssueTab } from "./issue-tab";
import { TemplatesTab } from "./templates-tab";
import { ArchiveTab } from "./archive-tab";
import { CertificateReportsTab } from "./reports-tab";

/**
 * The Certificates workspace (Module 27), in the order the office works:
 * what has been issued (Register), issuing one (Issue), the layouts they
 * print from (Templates), the school's filing cabinet (Archive), and the
 * register an inspector asks for (Reports).
 *
 * The **draft count sits in the header** rather than inside a tab, for the
 * reason a draft matters at all: it is a certificate somebody started and
 * did not finish, and the family is usually waiting at the counter.
 */
const TABS = [
  ["register", "Register"],
  ["issue", "Issue"],
  ["templates", "Templates"],
  ["archive", "Archive"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function CertificatesPage() {
  const [tab, setTab] = useState<TabKey>("register");

  const drafts = useQuery({
    queryKey: ["certificates", "draft-count"],
    queryFn: () => certificateApi.list({ status: "DRAFT", limit: 1 }),
  });

  const waiting = drafts.data?.meta?.total ?? 0;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Certificates & documents"
        description="Testimonials, transfer and character certificates — issued, verifiable, and kept in a register nobody can quietly edit."
      >
        {waiting > 0 && (
          <Badge
            variant="secondary"
            className="cursor-pointer"
            onClick={() => setTab("register")}
          >
            {waiting} draft{waiting === 1 ? "" : "s"} not yet issued
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

      {tab === "register" && <RegisterTab />}
      {tab === "issue" && <IssueTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "archive" && <ArchiveTab />}
      {tab === "reports" && <CertificateReportsTab />}
    </main>
  );
}
