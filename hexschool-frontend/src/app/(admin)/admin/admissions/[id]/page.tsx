"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  admissionCyclesApi,
  type CycleInput,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { cn } from "@/lib/utils";
import { CycleFormDialog } from "../cycle-form-dialog";
import { ApplicationsTab } from "./applications-tab";
import { MeritTab } from "./merit-tab";
import { ReportsTab } from "./reports-tab";
import { TestsTab } from "./tests-tab";

const TABS = [
  ["applications", "Applications"],
  ["tests", "Tests & Marks"],
  ["merit", "Merit List"],
  ["reports", "Reports"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function AdmissionCycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("applications");
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<"open" | "close" | "complete" | null>(
    null,
  );

  const cycle = useQuery({
    queryKey: ["admission-cycles", id],
    queryFn: () => admissionCyclesApi.get(id),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admission-cycles"] });

  const update = useMutation({
    mutationFn: (input: Partial<CycleInput>) =>
      admissionCyclesApi.update(id, input),
    onSuccess: () => {
      toast.success("Cycle updated.");
      setEditOpen(false);
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const lifecycle = useMutation({
    mutationFn: (action: "open" | "close" | "complete") =>
      admissionCyclesApi[action](id),
    onSuccess: (result) => {
      toast.success(`Cycle is now ${result.status}.`);
      setConfirm(null);
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (cycle.isPending) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <Spinner />
      </main>
    );
  }
  if (cycle.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState error={cycle.error} onRetry={() => void cycle.refetch()} />
      </main>
    );
  }

  const c = cycle.data;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {c.name}
            <Badge variant={c.status === "OPEN" ? "default" : "secondary"}>
              {c.status}
            </Badge>
          </span>
        }
        description={`${c.session.name} · ${c.startAt.slice(0, 10)} → ${c.endAt.slice(0, 10)} · ${
          c.testRequired ? "admission test required" : "no admission test"
        }`}
      >
        <Can permission="admission.cycle.manage">
          {c.status !== "COMPLETED" ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : null}
          {c.status === "DRAFT" || c.status === "CLOSED" ? (
            <Button onClick={() => setConfirm("open")}>
              Open applications
            </Button>
          ) : null}
          {c.status === "OPEN" ? (
            <Button variant="outline" onClick={() => setConfirm("close")}>
              Close applications
            </Button>
          ) : null}
          {c.status === "CLOSED" ? (
            <Button variant="outline" onClick={() => setConfirm("complete")}>
              Mark completed
            </Button>
          ) : null}
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

      {tab === "applications" ? (
        <ApplicationsTab cycle={c} />
      ) : tab === "tests" ? (
        <TestsTab cycle={c} />
      ) : tab === "merit" ? (
        <MeritTab cycle={c} />
      ) : (
        <ReportsTab cycleId={c.id} />
      )}

      <CycleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        cycle={c}
        onSubmit={(input) => update.mutate(input)}
        isPending={update.isPending}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm === "open"
            ? "Open this cycle for applications?"
            : confirm === "close"
              ? "Close applications?"
              : "Mark this cycle completed?"
        }
        description={
          confirm === "open"
            ? "The cycle appears on the public admission portal immediately."
            : confirm === "close"
              ? "Unpaid PAYMENT_PENDING applications are cancelled (SMS queued). Merit lists are generated after closing."
              : "A completed cycle becomes read-only."
        }
        confirmLabel={
          confirm === "open"
            ? "Open cycle"
            : confirm === "close"
              ? "Close cycle"
              : "Complete"
        }
        destructive={confirm === "close"}
        isPending={lifecycle.isPending}
        onConfirm={() => {
          if (confirm) lifecycle.mutate(confirm);
        }}
      />
    </main>
  );
}
