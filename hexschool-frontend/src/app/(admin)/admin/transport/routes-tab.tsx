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
  CAPACITY_VARIANT,
  driverApi,
  routeApi,
  vehicleApi,
  type Route,
  type RouteInput,
} from "@/lib/api/transport";

/**
 * The routes list, each with a **capacity bar** (roadmap §5).
 *
 * The bar is drawn from the server's verdict rather than from
 * `riders / seats` computed here, so the colour, the assignment
 * endpoint's refusal and the utilization report can never disagree — the
 * M16 `deriveStatus` / M23 `canIssue` single-verdict rule.
 */
export function RoutesTab() {
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["transport-routes"],
    queryFn: () => routeApi.list(),
  });

  const routes = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A route needs an ACTIVE status and a vehicle before children can be
          put on it. A bus in the workshop keeps its route — it is back on
          Monday.
        </p>
        <Can permission="transport.route.manage">
          <Button onClick={() => setCreating(true)}>New route</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : routes.length === 0 ? (
        <EmptyState
          title="No routes yet"
          description="Draw the first route, then add its stops and their monthly fares."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {routes.map((route) => (
            <RouteCard key={route.id} route={route} />
          ))}
        </div>
      )}

      {creating && <RouteDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function RouteCard({ route }: { route: Route }) {
  const { capacity } = route;
  const pct =
    capacity.capacity && capacity.capacity > 0
      ? Math.min(100, Math.round((capacity.assigned / capacity.capacity) * 100))
      : 0;

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/admin/transport/${route.id}`}
            className="font-medium hover:underline"
          >
            {route.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {route.vehicle ? route.vehicle.regNo : "No vehicle attached"}
            {route.driver ? ` · ${route.driver.name}` : ""}
          </p>
        </div>
        <Badge variant={route.status === "ACTIVE" ? "default" : "outline"}>
          {route.status}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {capacity.capacity === null
              ? `${capacity.assigned} rider(s), seats unknown`
              : `${capacity.assigned} of ${capacity.capacity} seats`}
          </span>
          <Badge variant={CAPACITY_VARIANT[capacity.state]}>
            {capacity.state === "SPACE"
              ? `${capacity.seatsLeft} free`
              : capacity.state}
          </Badge>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className={
              capacity.state === "OVER"
                ? "h-full bg-destructive"
                : capacity.state === "FULL"
                  ? "h-full bg-amber-500"
                  : "h-full bg-primary"
            }
            style={{ width: `${capacity.state === "OVER" ? 100 : pct}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {route.stops.length} stop(s)
        {route.window.firstPickup
          ? ` · ${route.window.firstPickup} → ${route.window.lastDrop ?? "—"}`
          : ""}
      </div>

      {route.issues.length > 0 && (
        <p className="text-xs text-amber-600">
          {route.issues.length} timing warning(s) — open the route to see them.
        </p>
      )}

      {route.substituteDriver && (
        <p className="text-xs text-muted-foreground">
          Substitute driving: {route.substituteDriver.name}
        </p>
      )}
    </div>
  );
}

export function RouteDialog({
  route,
  onClose,
}: {
  route?: Route;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<RouteInput>({
    name: route?.name ?? "",
    nameBn: route?.nameBn ?? "",
    description: route?.description ?? "",
    vehicleId: route?.vehicleId ?? null,
    driverId: route?.driverId ?? null,
    substituteDriverId: route?.substituteDriverId ?? null,
    helperName: route?.helperName ?? "",
    helperPhone: route?.helperPhone ?? "",
    status: route?.status ?? "ACTIVE",
  });

  const vehicles = useQuery({
    queryKey: ["transport-vehicles", "picker"],
    queryFn: () => vehicleApi.list({ limit: 100 }),
  });
  const drivers = useQuery({
    queryKey: ["transport-drivers", "picker"],
    queryFn: () => driverApi.list({ limit: 100 }),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: RouteInput = {
        name: values.name.trim(),
        status: values.status,
        vehicleId: values.vehicleId || null,
        driverId: values.driverId || null,
        substituteDriverId: values.substituteDriverId || null,
      };
      if (values.nameBn?.trim()) payload.nameBn = values.nameBn.trim();
      if (values.description?.trim())
        payload.description = values.description.trim();
      if (values.helperName?.trim())
        payload.helperName = values.helperName.trim();
      if (values.helperPhone?.trim())
        payload.helperPhone = values.helperPhone.trim();
      return route ? routeApi.update(route.id, payload) : routeApi.create(payload);
    },
    onSuccess: () => {
      toast.success(route ? "Saved." : "Route created.");
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      void qc.invalidateQueries({ queryKey: ["transport-route"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const sameDriver =
    !!values.driverId &&
    !!values.substituteDriverId &&
    values.driverId === values.substituteDriverId;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{route ? "Edit route" : "New route"}</DialogTitle>
          <DialogDescription>
            The vehicle and driver can be filled in later; children cannot be
            assigned until a vehicle is attached.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="r-name">Name</Label>
            <Input
              id="r-name"
              placeholder="Mirpur Morning"
              value={values.name}
              onChange={(event) =>
                setValues((v) => ({ ...v, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-name-bn">Name (Bangla)</Label>
            <Input
              id="r-name-bn"
              value={values.nameBn ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, nameBn: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-vehicle">Vehicle</Label>
            <select
              id="r-vehicle"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.vehicleId ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  vehicleId: event.target.value || null,
                }))
              }
            >
              <option value="">— none yet —</option>
              {(vehicles.data?.rows ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.regNo} ({vehicle.capacity} seats)
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-status">Status</Label>
            <select
              id="r-status"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.status}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  status: event.target.value as RouteInput["status"],
                }))
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-driver">Driver</Label>
            <select
              id="r-driver"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.driverId ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  driverId: event.target.value || null,
                }))
              }
            >
              <option value="">— none yet —</option>
              {(drivers.data?.rows ?? []).map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} ({driver.phone})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-substitute">Substitute driver</Label>
            <select
              id="r-substitute"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.substituteDriverId ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  substituteDriverId: event.target.value || null,
                }))
              }
            >
              <option value="">— none —</option>
              {(drivers.data?.rows ?? []).map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
            {sameDriver && (
              <p className="text-xs text-destructive">
                The substitute cannot be the driver — the substitute exists
                because the driver is away.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-helper">Helper</Label>
            <Input
              id="r-helper"
              value={values.helperName ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, helperName: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-helper-phone">Helper phone</Label>
            <Input
              id="r-helper-phone"
              placeholder="01712345678"
              value={values.helperPhone ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, helperPhone: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="r-description">Description</Label>
            <Input
              id="r-description"
              value={values.description ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, description: event.target.value }))
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
            disabled={values.name.trim().length < 2 || sameDriver || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
