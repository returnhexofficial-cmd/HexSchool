"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
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
  HOSTEL_STATUSES,
  HOSTEL_TYPES,
  HOSTEL_TYPE_LABELS,
  hostelApi,
  type HostelInput,
  type HostelSummary,
} from "@/lib/api/hostel";

/**
 * The buildings, each with its live occupancy bar.
 *
 * The bar is drawn from the **server's** `occupancy` object rather than
 * from `residents / capacity` computed here, so the colour, the
 * allocation endpoint's refusal and the occupancy report can never
 * disagree — the M16 `deriveStatus` / M23 `canIssue` / M25 capacity-bar
 * rule. It also inherits the decision that a bed out of service is not a
 * vacancy the school failed to fill.
 */
export function HostelsTab() {
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  const hostels = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          A hostel is for boys or for girls, and that is what makes the gender
          check possible — no permission gets past it. Rooms carry the seat
          rent; beds are what a student is actually given.
        </p>
        <Can permission="hostel.manage">
          <Button onClick={() => setCreating(true)}>New hostel</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : hostels.length === 0 ? (
        <EmptyState
          title="No hostels yet"
          description="Add the first building, then its rooms — the beds are generated with them."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hostels.map((summary) => (
            <HostelCard key={summary.hostel.id} summary={summary} />
          ))}
        </div>
      )}

      {creating && <HostelDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function HostelCard({ summary }: { summary: HostelSummary }) {
  const { hostel, occupancy } = summary;
  const pct = Math.min(100, Math.round(occupancy.utilization));

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/admin/hostel/${hostel.id}`}
            className="font-medium hover:underline"
          >
            {hostel.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {HOSTEL_TYPE_LABELS[hostel.type]} ·{" "}
            {summary.rooms === 1 ? "1 room" : `${summary.rooms} rooms`}
            {hostel.wardenStaff
              ? ` · Warden ${hostel.wardenStaff.firstName} ${hostel.wardenStaff.lastName}`
              : " · No warden recorded"}
          </p>
        </div>
        <Badge variant={hostel.status === "ACTIVE" ? "default" : "outline"}>
          {hostel.status}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {occupancy.occupied} of {occupancy.total - occupancy.maintenance}{" "}
            usable bed(s) taken
          </span>
          <Badge variant={pct >= 100 ? "secondary" : "default"}>{pct}%</Badge>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={
              pct >= 100 ? "h-full bg-amber-500" : "h-full bg-primary"
            }
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {occupancy.available} free
          {occupancy.maintenance > 0
            ? ` · ${occupancy.maintenance} out of service`
            : ""}
        </p>
      </div>

      {summary.capacityNote && (
        <p className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {summary.capacityNote}
        </p>
      )}
    </div>
  );
}

export function HostelDialog({
  hostel,
  onClose,
}: {
  hostel?: HostelSummary["hostel"];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<HostelInput>({
    name: hostel?.name ?? "",
    nameBn: hostel?.nameBn ?? "",
    type: hostel?.type ?? "BOYS",
    address: hostel?.address ?? "",
    phone: hostel?.phone ?? "",
    capacity: hostel?.capacity ?? 0,
    status: hostel?.status ?? "ACTIVE",
    notes: hostel?.notes ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: HostelInput = {
        ...form,
        nameBn: form.nameBn || undefined,
        address: form.address || undefined,
        phone: form.phone || undefined,
        notes: form.notes || undefined,
      };
      return hostel
        ? hostelApi.update(hostel.id, payload)
        : hostelApi.create(payload);
    },
    onSuccess: () => {
      toast.success(hostel ? "Hostel updated" : "Hostel added");
      void qc.invalidateQueries({ queryKey: ["hostels"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{hostel ? "Edit hostel" : "New hostel"}</DialogTitle>
          <DialogDescription>
            What the building is for cannot be changed once anybody lives in
            it — every allocation was checked against it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="hostel-name">Name</Label>
            <Input
              id="hostel-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Shapla Hostel"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hostel-name-bn">Name (Bangla)</Label>
            <Input
              id="hostel-name-bn"
              value={form.nameBn ?? ""}
              onChange={(e) => setForm({ ...form, nameBn: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="hostel-type">For</Label>
              <select
                id="hostel-type"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    type: e.target.value as HostelInput["type"],
                  })
                }
              >
                {HOSTEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {HOSTEL_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="hostel-status">Status</Label>
              <select
                id="hostel-status"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as HostelInput["status"],
                  })
                }
              >
                {HOSTEL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="hostel-phone">Phone</Label>
              <Input
                id="hostel-phone"
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="01712345678"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="hostel-capacity">Declared capacity</Label>
              <Input
                id="hostel-capacity"
                type="number"
                min={0}
                value={form.capacity ?? 0}
                onChange={(e) =>
                  setForm({ ...form, capacity: Number(e.target.value) })
                }
              />
              <p className="text-xs text-muted-foreground">
                Printed beside the real bed count. Never used to refuse an
                allocation.
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hostel-address">Address</Label>
            <Input
              id="hostel-address"
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || form.name.trim().length < 2}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
