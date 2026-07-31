"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPES,
  expenseApi,
  formatBdt,
  transportReportApi,
  vehicleApi,
  type ExpenseInput,
  type ExpenseType,
  type VehicleExpense,
} from "@/lib/api/transport";

/**
 * The fuel and workshop log, with the monthly chart roadmap §5 asks for.
 *
 * The chart is drawn from the report's series, which emits a **zero row**
 * for a month nothing was spent in — the inverse of the M18 attendance
 * rule, and deliberately: a month with no fuel receipts is a month the
 * school genuinely spent nothing, not a month nobody recorded.
 */
export function ExpensesTab() {
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState<ExpenseType | "">("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VehicleExpense | null>(null);

  const vehicles = useQuery({
    queryKey: ["transport-vehicles", "picker"],
    queryFn: () => vehicleApi.list({ limit: 100 }),
  });

  const list = useQuery({
    queryKey: ["transport-expenses", vehicleId, type],
    queryFn: () =>
      expenseApi.list({
        vehicleId: vehicleId || undefined,
        type: type || undefined,
        limit: 100,
      }),
  });

  const report = useQuery({
    queryKey: ["transport-expense-report", vehicleId],
    queryFn: () =>
      transportReportApi.expenses({ vehicleId: vehicleId || undefined }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => expenseApi.remove(id),
    onSuccess: (_result, id) => {
      const row = list.data?.rows.find((expense) => expense.id === id);
      toast.success(
        row?.voucherId
          ? "Expense removed. Its ledger voucher stands — ask the accountant to reverse it."
          : "Expense removed.",
      );
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["transport-expenses"] });
      void qc.invalidateQueries({ queryKey: ["transport-expense-report"] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const rows = list.data?.rows ?? [];
  const summary = report.data?.summary;
  const series = report.data?.series ?? [];
  const peak = Math.max(1, ...series.map((point) => point.total));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total spend" value={`৳${formatBdt(summary?.total ?? 0)}`} />
        <StatCard title="Fuel" value={`৳${formatBdt(summary?.fuelTotal ?? 0)}`} />
        <StatCard
          title="Distance"
          value={`${(summary?.distance.km ?? 0).toLocaleString()} km`}
          hint={
            summary && summary.distance.brokenChains > 0
              ? `${summary.distance.brokenChains} reading(s) went backwards and were skipped`
              : undefined
          }
        />
        <StatCard
          title="Cost per km"
          value={
            summary?.totalCostPerKm === null || summary === undefined
              ? "—"
              : `৳${formatBdt(summary.totalCostPerKm)}`
          }
          hint="Needs two odometer readings"
        />
      </div>

      {series.length > 0 && (
        <div className="rounded-md border p-4">
          <p className="mb-3 text-sm font-medium">Monthly spend</p>
          <div className="flex items-end gap-2">
            {series.map((point) => (
              <div key={point.month} className="flex-1 space-y-1 text-center">
                <div
                  className="mx-auto w-full rounded-t bg-primary/80"
                  style={{ height: `${Math.round((point.total / peak) * 96) + 2}px` }}
                  title={`৳${formatBdt(point.total)}`}
                />
                <span className="block text-[10px] text-muted-foreground">
                  {point.month.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56 space-y-1">
            <Label htmlFor="expense-vehicle">Vehicle</Label>
            <select
              id="expense-vehicle"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">All vehicles</option>
              {(vehicles.data?.rows ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.regNo}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40 space-y-1">
            <Label htmlFor="expense-type">Type</Label>
            <select
              id="expense-type"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value as ExpenseType | "")}
            >
              <option value="">All</option>
              {EXPENSE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {EXPENSE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Can permission="transport.expense.manage">
          <Button onClick={() => setCreating(true)}>Record spending</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No spending recorded"
          description="Fuel, maintenance, repairs and tolls. Recording the odometer with a fuel receipt is what makes the cost-per-kilometre figure possible."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Odometer</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="text-sm">
                    {expense.date.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {expense.vehicle.regNo}
                  </TableCell>
                  <TableCell className="text-sm">
                    {EXPENSE_TYPE_LABELS[expense.type]}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    ৳{formatBdt(expense.amount)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {expense.odometer?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                    {expense.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {expense.voucherId ? (
                      <Badge variant="default">Posted</Badge>
                    ) : (
                      <Badge variant="outline">Not posted</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="transport.expense.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(expense)}
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

      {creating && (
        <ExpenseDialog
          vehicles={(vehicles.data?.rows ?? []).map((vehicle) => ({
            id: vehicle.id,
            regNo: vehicle.regNo,
          }))}
          onClose={() => setCreating(false)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this expense?"
        description="A posted expense keeps its ledger voucher — reversing a posted entry is the accountant's call, not the fleet desk's."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function ExpenseDialog({
  vehicles,
  onClose,
}: {
  vehicles: Array<{ id: string; regNo: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<ExpenseInput>({
    vehicleId: vehicles[0]?.id ?? "",
    type: "FUEL",
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: ExpenseInput = {
        vehicleId: values.vehicleId,
        type: values.type,
        date: values.date,
        amount: Number(values.amount),
      };
      if (values.odometer) payload.odometer = Number(values.odometer);
      if (values.description?.trim())
        payload.description = values.description.trim();
      if (values.receiptUrl?.trim())
        payload.receiptUrl = values.receiptUrl.trim();
      return expenseApi.create(payload);
    },
    onSuccess: (result) => {
      toast.success(
        result.expense.voucherId
          ? "Recorded and posted to the ledger."
          : "Recorded.",
      );
      for (const warning of result.warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["transport-expenses"] });
      void qc.invalidateQueries({ queryKey: ["transport-expense-report"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record spending</DialogTitle>
          <DialogDescription>
            Posted to the ledger automatically as Dr Transport Expense, Cr Cash
            (Module 20) when accounting is on.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="e-vehicle">Vehicle</Label>
            <select
              id="e-vehicle"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.vehicleId}
              onChange={(event) =>
                setValues((v) => ({ ...v, vehicleId: event.target.value }))
              }
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.regNo}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-type">Type</Label>
            <select
              id="e-type"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={values.type}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  type: event.target.value as ExpenseType,
                }))
              }
            >
              {EXPENSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EXPENSE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-date">Date</Label>
            <Input
              id="e-date"
              type="date"
              value={values.date}
              onChange={(event) =>
                setValues((v) => ({ ...v, date: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-amount">Amount (BDT)</Label>
            <Input
              id="e-amount"
              type="number"
              step="0.01"
              min={0.01}
              value={values.amount}
              onChange={(event) =>
                setValues((v) => ({ ...v, amount: Number(event.target.value) }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-odometer">Odometer (km)</Label>
            <Input
              id="e-odometer"
              type="number"
              min={0}
              value={values.odometer ?? ""}
              onChange={(event) =>
                setValues((v) => ({
                  ...v,
                  odometer: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-receipt">Receipt link</Label>
            <Input
              id="e-receipt"
              placeholder="https://…"
              value={values.receiptUrl ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, receiptUrl: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="e-description">Description</Label>
            <Input
              id="e-description"
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
            disabled={
              !values.vehicleId || Number(values.amount) <= 0 || save.isPending
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
