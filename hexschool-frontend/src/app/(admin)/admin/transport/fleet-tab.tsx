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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  DRIVER_STATUS_LABELS,
  DRIVER_STATUSES,
  driverApi,
  EXPIRY_LABELS,
  EXPIRY_VARIANT,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  vehicleApi,
  type Driver,
  type DriverInput,
  type ExpiryItem,
  type Vehicle,
  type VehicleInput,
} from "@/lib/api/transport";

type Half = "vehicles" | "drivers";

/**
 * The fleet: what the school drives, who drives it, and — the column that
 * matters — how close their papers are to lapsing.
 *
 * The document state is rendered **in the list**, not only in the nightly
 * alert, because an office that has to open a row to find out its
 * insurance expired last month will find out from the police instead.
 */
export function FleetTab() {
  const [half, setHalf] = useState<Half>("vehicles");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["vehicles", "Vehicles"],
            ["drivers", "Drivers"],
          ] as Array<[Half, string]>
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={half === key ? "secondary" : "ghost"}
            size="sm"
            className={cn(half === key && "font-medium")}
            onClick={() => setHalf(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {half === "vehicles" ? <VehicleList /> : <DriverList />}
    </div>
  );
}

function DocumentBadges({ documents }: { documents: ExpiryItem[] }) {
  const flagged = documents.filter((item) => item.state !== "OK");
  if (flagged.length === 0) {
    return <Badge variant="default">Papers current</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flagged.map((item) => (
        <Badge key={item.kind} variant={EXPIRY_VARIANT[item.state]}>
          {item.label}: {EXPIRY_LABELS[item.state]}
          {item.state === "DUE_SOON" && item.daysLeft !== null
            ? ` (${item.daysLeft}d)`
            : ""}
        </Badge>
      ))}
    </div>
  );
}

// ── vehicles ────────────────────────────────────────────────────────────

function VehicleList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);

  const list = useQuery({
    queryKey: ["transport-vehicles", search],
    queryFn: () =>
      vehicleApi.list({ search: search.trim() || undefined, limit: 100 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => vehicleApi.remove(id),
    onSuccess: () => {
      toast.success("Vehicle removed.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["transport-vehicles"] });
      void qc.invalidateQueries({ queryKey: ["transport-alerts"] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64 space-y-1">
          <Label htmlFor="vehicle-search">Search</Label>
          <Input
            id="vehicle-search"
            placeholder="Registration or model"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Can permission="transport.vehicle.manage">
          <Button onClick={() => setCreating(true)}>Add vehicle</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No vehicles yet"
          description="Add the buses, microbuses and vans the school runs — a route needs one before children can be put on it."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Registration</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Papers</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((vehicle) => (
                <TableRow key={vehicle.id}>
                  <TableCell className="font-medium">
                    {vehicle.regNo}
                    {vehicle.makeModel && (
                      <span className="block text-xs text-muted-foreground">
                        {vehicle.makeModel}
                        {vehicle.modelYear ? ` · ${vehicle.modelYear}` : ""}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{vehicle.type}</TableCell>
                  <TableCell className="text-right">{vehicle.capacity}</TableCell>
                  <TableCell className="text-sm">
                    {VEHICLE_STATUS_LABELS[vehicle.status]}
                  </TableCell>
                  <TableCell>
                    <DocumentBadges documents={vehicle.documents} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="transport.vehicle.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(vehicle)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(vehicle)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(creating || editing) && (
        <VehicleDialog
          vehicle={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.regNo ?? ""}?`}
        description="A vehicle attached to a route, or carrying expense records, is refused with a count — set it INACTIVE instead, so the spend stays in the accounts."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function VehicleDialog({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<VehicleInput>({
    regNo: vehicle?.regNo ?? "",
    type: vehicle?.type ?? "BUS",
    capacity: vehicle?.capacity ?? 40,
    makeModel: vehicle?.makeModel ?? "",
    modelYear: vehicle?.modelYear ?? undefined,
    status: vehicle?.status ?? "ACTIVE",
    fitnessExpiry: vehicle?.fitnessExpiry?.slice(0, 10) ?? "",
    taxTokenExpiry: vehicle?.taxTokenExpiry?.slice(0, 10) ?? "",
    insuranceExpiry: vehicle?.insuranceExpiry?.slice(0, 10) ?? "",
    notes: vehicle?.notes ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: VehicleInput = {
        regNo: values.regNo.trim(),
        type: values.type,
        capacity: Number(values.capacity),
        status: values.status,
      };
      if (values.makeModel?.trim()) payload.makeModel = values.makeModel.trim();
      if (values.modelYear) payload.modelYear = Number(values.modelYear);
      if (values.fitnessExpiry) payload.fitnessExpiry = values.fitnessExpiry;
      if (values.taxTokenExpiry) payload.taxTokenExpiry = values.taxTokenExpiry;
      if (values.insuranceExpiry)
        payload.insuranceExpiry = values.insuranceExpiry;
      if (values.notes?.trim()) payload.notes = values.notes.trim();
      return vehicle
        ? vehicleApi.update(vehicle.id, payload)
        : vehicleApi.create(payload);
    },
    onSuccess: (result) => {
      toast.success(vehicle ? "Saved." : "Vehicle added.");
      // Roadmap §7: a lapsed date is a WARNING, not a refusal — the row
      // is saved and the office is told what it just recorded.
      for (const warning of result.warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["transport-vehicles"] });
      void qc.invalidateQueries({ queryKey: ["transport-alerts"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const invalid =
    values.regNo.trim().length < 3 ||
    !Number.isFinite(Number(values.capacity)) ||
    Number(values.capacity) < 1;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
          <DialogDescription>
            The registration is free text — BD plates are written several
            ways — but two live vehicles may not share one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="v-reg">Registration</Label>
            <Input
              id="v-reg"
              placeholder="DHAKA METRO GA 11-2345"
              value={values.regNo}
              onChange={(event) =>
                setValues((v) => ({ ...v, regNo: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-type">Type</Label>
            <select
              id="v-type"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.type}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  type: event.target.value as VehicleInput["type"],
                }))
              }
            >
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-capacity">Seats</Label>
            <Input
              id="v-capacity"
              type="number"
              min={1}
              max={200}
              value={values.capacity}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  capacity: Number(event.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-status">Status</Label>
            <select
              id="v-status"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.status}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  status: event.target.value as VehicleInput["status"],
                }))
              }
            >
              {VEHICLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {VEHICLE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-model">Make / model</Label>
            <Input
              id="v-model"
              value={values.makeModel ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, makeModel: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-year">Year</Label>
            <Input
              id="v-year"
              type="number"
              value={values.modelYear ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  modelYear: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-fitness">Fitness expires</Label>
            <Input
              id="v-fitness"
              type="date"
              value={values.fitnessExpiry ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, fitnessExpiry: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-tax">Tax token expires</Label>
            <Input
              id="v-tax"
              type="date"
              value={values.taxTokenExpiry ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, taxTokenExpiry: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-insurance">Insurance expires</Label>
            <Input
              id="v-insurance"
              type="date"
              value={values.insuranceExpiry ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  insuranceExpiry: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="v-notes">Notes</Label>
            <Input
              id="v-notes"
              value={values.notes ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, notes: event.target.value }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={invalid || save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── drivers ─────────────────────────────────────────────────────────────

function DriverList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Driver | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Driver | null>(null);

  const list = useQuery({
    queryKey: ["transport-drivers", search],
    queryFn: () =>
      driverApi.list({ search: search.trim() || undefined, limit: 100 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => driverApi.remove(id),
    onSuccess: () => {
      toast.success("Driver removed.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["transport-drivers"] });
      void qc.invalidateQueries({ queryKey: ["transport-alerts"] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64 space-y-1">
          <Label htmlFor="driver-search">Search</Label>
          <Input
            id="driver-search"
            placeholder="Name, phone or licence"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Can permission="transport.driver.manage">
          <Button onClick={() => setCreating(true)}>Add driver</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No drivers yet"
          description="A driver can be a staff member on the payroll or a contractor — the staff link is optional."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Papers</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((driver) => (
                <TableRow key={driver.id}>
                  <TableCell className="font-medium">
                    {driver.name}
                    {driver.staff && (
                      <span className="block text-xs text-muted-foreground">
                        Staff {driver.staff.employeeId}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{driver.phone}</TableCell>
                  <TableCell className="text-sm">{driver.licenseNo}</TableCell>
                  <TableCell className="text-sm">
                    {DRIVER_STATUS_LABELS[driver.status]}
                  </TableCell>
                  <TableCell>
                    <DocumentBadges documents={driver.documents} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="transport.driver.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(driver)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(driver)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(creating || editing) && (
        <DriverDialog
          driver={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.name ?? ""}?`}
        description="A driver still on a route (as driver or substitute) is refused with a count — reassign the route first."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function DriverDialog({
  driver,
  onClose,
}: {
  driver: Driver | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<DriverInput>({
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    licenseNo: driver?.licenseNo ?? "",
    licenseExpiry: driver?.licenseExpiry?.slice(0, 10) ?? "",
    address: driver?.address ?? "",
    status: driver?.status ?? "ACTIVE",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: DriverInput = {
        name: values.name.trim(),
        phone: values.phone.trim(),
        licenseNo: values.licenseNo.trim(),
        status: values.status,
      };
      if (values.licenseExpiry) payload.licenseExpiry = values.licenseExpiry;
      if (values.address?.trim()) payload.address = values.address.trim();
      return driver
        ? driverApi.update(driver.id, payload)
        : driverApi.create(payload);
    },
    onSuccess: (result) => {
      toast.success(driver ? "Saved." : "Driver added.");
      for (const warning of result.warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["transport-drivers"] });
      void qc.invalidateQueries({ queryKey: ["transport-alerts"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const invalid =
    values.name.trim().length < 2 ||
    !/^01[3-9]\d{8}$/.test(values.phone.trim()) ||
    values.licenseNo.trim().length < 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{driver ? "Edit driver" : "Add driver"}</DialogTitle>
          <DialogDescription>
            The licence number is unique among live drivers — it is how the
            school knows who is behind the wheel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="d-name">Name</Label>
            <Input
              id="d-name"
              value={values.name}
              onChange={(event) =>
                setValues((v) => ({ ...v, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-phone">Phone</Label>
            <Input
              id="d-phone"
              placeholder="01712345678"
              value={values.phone}
              onChange={(event) =>
                setValues((v) => ({ ...v, phone: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-license">Licence number</Label>
            <Input
              id="d-license"
              value={values.licenseNo}
              onChange={(event) =>
                setValues((v) => ({ ...v, licenseNo: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-license-expiry">Licence expires</Label>
            <Input
              id="d-license-expiry"
              type="date"
              value={values.licenseExpiry ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, licenseExpiry: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-status">Status</Label>
            <select
              id="d-status"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.status}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  status: event.target.value as DriverInput["status"],
                }))
              }
            >
              {DRIVER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {DRIVER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-address">Address</Label>
            <Input
              id="d-address"
              value={values.address ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, address: event.target.value }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={invalid || save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
