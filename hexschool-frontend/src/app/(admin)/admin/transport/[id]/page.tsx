"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
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
  CAPACITY_VARIANT,
  formatBdt,
  routeApi,
  type Route,
  type RouteStop,
  type StopInput,
} from "@/lib/api/transport";
import { RouteDialog } from "../routes-tab";

/**
 * One route: its vehicle and crew, its capacity bar, and the stop list in
 * the order the bus drives them (roadmap §5 "route detail with draggable
 * stops + fee editing; capacity bar").
 *
 * Reordering is **up/down rather than HTML5 drag**: the order goes to the
 * server as a list of ids, where a two-phase update writes it around the
 * live-rows unique on `(route_id, display_order)` — the M11 renumber
 * problem. Buttons are also the thing that works on the phone an office
 * clerk actually has.
 */
export default function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editingRoute, setEditingRoute] = useState(false);
  const [editingStop, setEditingStop] = useState<RouteStop | null>(null);
  const [addingStop, setAddingStop] = useState(false);
  const [deletingStop, setDeletingStop] = useState<RouteStop | null>(null);

  const query = useQuery({
    queryKey: ["transport-route", id],
    queryFn: () => routeApi.get(id),
  });

  const reorder = useMutation({
    mutationFn: (stopIds: string[]) => routeApi.reorderStops(id, stopIds),
    onSuccess: (route) => {
      qc.setQueryData(["transport-route", id], route);
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const removeStop = useMutation({
    mutationFn: (stopId: string) => routeApi.removeStop(id, stopId),
    onSuccess: () => {
      toast.success("Stop removed.");
      setDeletingStop(null);
      void qc.invalidateQueries({ queryKey: ["transport-route", id] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
    },
    onError: (err) => {
      setDeletingStop(null);
      toast.error(apiErrorMessage(err));
    },
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void query.refetch()} />
      </main>
    );
  }

  const route = query.data!;
  const stops = [...route.stops].sort((a, b) => a.displayOrder - b.displayOrder);
  const ridersByStop = new Map(
    route.stopLoads.map((load) => [load.stopId, load.riders]),
  );

  const move = (index: number, delta: number) => {
    const next = [...stops];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((stop) => stop.id));
  };

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader title={route.name} description={route.description ?? undefined}>
        <div className="space-x-2">
          <Button variant="ghost" asChild>
            <Link href="/admin/transport">Back</Link>
          </Button>
          <Can permission="transport.route.manage">
            <Button variant="outline" onClick={() => setEditingRoute(true)}>
              Edit route
            </Button>
            <Button onClick={() => setAddingStop(true)}>Add stop</Button>
          </Can>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Vehicle"
          value={route.vehicle?.regNo ?? "—"}
          hint={
            route.vehicle
              ? `${route.vehicle.capacity} seats · ${route.vehicle.status}`
              : "Attach one before assigning children"
          }
        />
        <StatCard
          title="Driver"
          value={route.driver?.name ?? "—"}
          hint={
            route.substituteDriver
              ? `Substitute: ${route.substituteDriver.name}`
              : (route.driver?.phone ?? undefined)
          }
        />
        <StatCard
          title="Riders"
          value={
            route.capacity.capacity === null
              ? String(route.capacity.assigned)
              : `${route.capacity.assigned} / ${route.capacity.capacity}`
          }
          hint={route.capacity.message ?? undefined}
        />
        <StatCard
          title="Window"
          value={
            route.window.firstPickup
              ? `${route.window.firstPickup} → ${route.window.lastDrop ?? "—"}`
              : "—"
          }
          hint={`${stops.length} stop(s)`}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Capacity</span>
          <Badge variant={CAPACITY_VARIANT[route.capacity.state]}>
            {route.capacity.state}
          </Badge>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className={
              route.capacity.state === "OVER"
                ? "h-full bg-destructive"
                : route.capacity.state === "FULL"
                  ? "h-full bg-amber-500"
                  : "h-full bg-primary"
            }
            style={{
              width:
                route.capacity.capacity && route.capacity.capacity > 0
                  ? `${Math.min(
                      100,
                      Math.round(
                        (route.capacity.assigned / route.capacity.capacity) * 100,
                      ),
                    )}%`
                  : "0%",
            }}
          />
        </div>
      </div>

      {route.issues.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">Timing warnings</p>
          {route.issues.map((issue, index) => (
            <p key={`${issue.stopId}-${index}`}>
              {issue.stopName}: {issue.message}
            </p>
          ))}
        </div>
      )}

      {stops.length === 0 ? (
        <EmptyState
          title="No stops yet"
          description="Add the pickup points in the order the bus drives them. The monthly fare lives on the stop, because distance is what a school charges for."
        />
      ) : (
        <div className="space-y-2">
          {stops.map((stop, index) => (
            <div
              key={stop.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-sm text-muted-foreground">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium">{stop.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Pickup {stop.pickupTime ?? "—"} · drop {stop.dropTime ?? "—"}
                    {stop.landmark ? ` · ${stop.landmark}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  ৳{formatBdt(stop.monthlyFee)}
                  <span className="text-muted-foreground"> / month</span>
                </span>
                <Badge variant="outline">
                  {ridersByStop.get(stop.id) ?? 0} rider(s)
                </Badge>
                <Can permission="transport.route.manage">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === stops.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingStop(stop)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeletingStop(stop)}
                  >
                    Delete
                  </Button>
                </Can>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingRoute && (
        <RouteDialog route={route} onClose={() => setEditingRoute(false)} />
      )}
      {(addingStop || editingStop) && (
        <StopDialog
          route={route}
          stop={editingStop}
          onClose={() => {
            setAddingStop(false);
            setEditingStop(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deletingStop !== null}
        onOpenChange={(open) => !open && setDeletingStop(null)}
        title={`Remove "${deletingStop?.name ?? ""}"?`}
        description="A stop with riders on it is refused with a count — deleting it would stop their transport billing silently."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deletingStop) removeStop.mutate(deletingStop.id);
        }}
      />
    </main>
  );
}

function StopDialog({
  route,
  stop,
  onClose,
}: {
  route: Route;
  stop: RouteStop | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<StopInput>({
    name: stop?.name ?? "",
    landmark: stop?.landmark ?? "",
    pickupTime: stop?.pickupTime ?? "",
    dropTime: stop?.dropTime ?? "",
    monthlyFee: Number(stop?.monthlyFee ?? 0),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: StopInput = {
        name: values.name.trim(),
        monthlyFee: Number(values.monthlyFee),
      };
      if (values.landmark?.trim()) payload.landmark = values.landmark.trim();
      if (values.pickupTime) payload.pickupTime = values.pickupTime;
      if (values.dropTime) payload.dropTime = values.dropTime;
      return stop
        ? routeApi.updateStop(route.id, stop.id, payload)
        : routeApi.addStop(route.id, payload);
    },
    onSuccess: () => {
      toast.success(stop ? "Stop saved." : "Stop added.");
      void qc.invalidateQueries({ queryKey: ["transport-route", route.id] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const badTimes =
    !!values.pickupTime &&
    !!values.dropTime &&
    values.dropTime <= values.pickupTime;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stop ? "Edit stop" : "Add stop"}</DialogTitle>
          <DialogDescription>
            The monthly fare is charged from here. Editing it changes future
            bills only — invoices already raised are history.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="s-name">Stop name</Label>
            <Input
              id="s-name"
              placeholder="Kazipara"
              value={values.name}
              onChange={(event) =>
                setValues((v) => ({ ...v, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="s-landmark">Landmark</Label>
            <Input
              id="s-landmark"
              placeholder="Beside the mosque"
              value={values.landmark ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, landmark: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-pickup">Pickup (HH:MM)</Label>
            <Input
              id="s-pickup"
              type="time"
              value={values.pickupTime ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, pickupTime: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-drop">Drop (HH:MM)</Label>
            <Input
              id="s-drop"
              type="time"
              value={values.dropTime ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, dropTime: event.target.value }))
              }
            />
            {badTimes && (
              <p className="text-xs text-amber-600">
                The afternoon drop is usually after the morning pickup — check
                which run this is.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-fee">Monthly fare (BDT)</Label>
            <Input
              id="s-fee"
              type="number"
              min={0}
              step="0.01"
              value={values.monthlyFee}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  monthlyFee: Number(event.target.value),
                }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              values.name.trim().length < 2 ||
              Number(values.monthlyFee) < 0 ||
              save.isPending
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
