"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatBdt,
  hostelApi,
  messApi,
  type MessPlan,
  type MessPlanInput,
} from "@/lib/api/hostel";

/**
 * The kitchen's plans, per building.
 *
 * A plan **belongs to one hostel and a boarder may only be put on a plan
 * of the building they live in** — a composite foreign key over
 * `(hostel_id, plan_id)` makes that a database fact rather than a
 * service's memory. Get it wrong and the invoice still balances; it is
 * simply the wrong number for a kitchen that never cooked for them.
 */
export function MessTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MessPlan | null>(null);
  const [deleting, setDeleting] = useState<MessPlan | null>(null);

  const plans = useQuery({
    queryKey: ["mess-plans"],
    queryFn: () => messApi.plans(),
  });

  const hostels = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  const nameOf = (hostelId: string) =>
    hostels.data?.find((h) => h.hostel.id === hostelId)?.hostel.name ??
    "Unknown hostel";

  const remove = useMutation({
    mutationFn: (id: string) => messApi.removePlan(id),
    onSuccess: () => {
      toast.success("Plan deleted");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["mess-plans"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const rows = plans.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          A plan is a monthly figure, not a menu. Deleting one with boarders
          on it is refused — it would stop billing those families without
          anybody noticing.
        </p>
        <Can permission="hostel.mess.manage">
          <Button onClick={() => setCreating(true)}>New plan</Button>
        </Can>
      </div>

      {plans.isLoading ? (
        <LoadingBlock />
      ) : plans.isError ? (
        <ErrorState onRetry={() => void plans.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No mess plans yet"
          description="Add a plan and boarders can be put on it when they are allocated a bed."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Plan</th>
                <th className="p-3 font-medium">Hostel</th>
                <th className="p-3 font-medium">Monthly charge</th>
                <th className="p-3 font-medium">Boarders on it</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((plan) => (
                <tr key={plan.id} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">{plan.name}</div>
                    {plan.description && (
                      <div className="text-xs text-muted-foreground">
                        {plan.description}
                      </div>
                    )}
                  </td>
                  <td className="p-3">{nameOf(plan.hostelId)}</td>
                  <td className="p-3">৳{formatBdt(plan.monthlyCharge)}</td>
                  <td className="p-3">{plan.subscribers}</td>
                  <td className="p-3">
                    <Badge
                      variant={plan.status === "ACTIVE" ? "default" : "outline"}
                    >
                      {plan.status === "ACTIVE" ? "Offered" : "Withdrawn"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Can permission="hostel.mess.manage">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(plan)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleting(plan)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <MessPlanDialog
          plan={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          destructive
          title={`Delete "${deleting.name}"?`}
          description={
            deleting.subscribers > 0
              ? `${deleting.subscribers} boarder(s) are on this plan — the server will refuse. Move them first.`
              : "No boarders are on this plan."
          }
          confirmLabel="Delete"
          isPending={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}
    </div>
  );
}

function MessPlanDialog({
  plan,
  onClose,
}: {
  plan?: MessPlan;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const hostels = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  const [form, setForm] = useState<MessPlanInput>({
    hostelId: plan?.hostelId ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    monthlyCharge: plan ? Number(plan.monthlyCharge) : 0,
    status: plan?.status ?? "ACTIVE",
  });

  const save = useMutation({
    mutationFn: () =>
      plan
        ? messApi.updatePlan(plan.id, form)
        : messApi.createPlan(form),
    onSuccess: () => {
      toast.success(plan ? "Plan updated" : "Plan added");
      void qc.invalidateQueries({ queryKey: ["mess-plans"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Edit plan" : "New mess plan"}</DialogTitle>
          <DialogDescription>
            A plan belongs to one building and cannot be moved — create one in
            the other hostel instead.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="plan-hostel">Hostel</Label>
            <select
              id="plan-hostel"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={form.hostelId}
              disabled={Boolean(plan)}
              onChange={(e) => setForm({ ...form, hostelId: e.target.value })}
            >
              <option value="">Pick a hostel…</option>
              {(hostels.data ?? []).map((summary) => (
                <option key={summary.hostel.id} value={summary.hostel.id}>
                  {summary.hostel.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full board"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-charge">Monthly charge (BDT)</Label>
              <Input
                id="plan-charge"
                type="number"
                min={0}
                step="0.01"
                value={form.monthlyCharge}
                onChange={(e) =>
                  setForm({ ...form, monthlyCharge: Number(e.target.value) })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-status">Status</Label>
              <select
                id="plan-status"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as MessPlanInput["status"],
                  })
                }
              >
                <option value="ACTIVE">Offered</option>
                <option value="INACTIVE">Withdrawn</option>
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="plan-desc">Description</Label>
            <Input
              id="plan-desc"
              value={form.description ?? ""}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Three meals a day, seven days a week"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending || !form.hostelId || form.name.trim().length < 2
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
