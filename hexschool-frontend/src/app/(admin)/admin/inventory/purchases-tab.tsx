"use client";

import { useMemo, useState } from "react";
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
  ASSET_CONDITIONS,
  formatBdt,
  formatQty,
  inventoryApi,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_VARIANT,
  type AssetCondition,
  type Item,
  type Purchase,
  type PurchaseStatus,
} from "@/lib/api/inventory";

interface DraftLine {
  itemId: string;
  qty: string;
  unitPrice: string;
}

/**
 * Deliveries: the line grid, the receipt confirmation, and the cancel.
 *
 * **The grid totals in the same arithmetic the server uses** — each line
 * rounded to the paisa before the sum, not the sum rounded afterwards.
 * The two have to agree or the accounting voucher will not balance, and a
 * paisa of disagreement in a header is the kind of thing nobody finds for
 * a year.
 *
 * Receiving is where everything happens (stock in, asset tags, the
 * voucher), and it is one-way: a RECEIVED delivery is immutable, so the
 * Save and Delete buttons disappear rather than 409-ing.
 */
export function PurchasesTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<PurchaseStatus | "">("");
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);

  const purchases = useQuery({
    queryKey: ["inventory-purchases", status],
    queryFn: () =>
      inventoryApi.listPurchases({ status: status || undefined, limit: 100 }),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-purchases"] });
    void qc.invalidateQueries({ queryKey: ["inventory-items"] });
    void qc.invalidateQueries({ queryKey: ["inventory-low-stock"] });
  };

  const rows = purchases.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="pur-status">Status</Label>
          <select
            id="pur-status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as PurchaseStatus | "")
            }
          >
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <Can permission="inventory.purchase.manage">
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            New purchase
          </Button>
        </Can>
      </div>

      {purchases.isLoading && <LoadingBlock />}
      {purchases.isError && <ErrorState onRetry={() => void purchases.refetch()} />}
      {purchases.isSuccess && rows.length === 0 && (
        <EmptyState
          title="No deliveries recorded"
          description="Enter what the school bought, then receive it to move the stock."
        />
      )}

      {purchases.isSuccess && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell className="font-mono text-xs">
                    {purchase.purchaseNo}
                  </TableCell>
                  <TableCell>{purchase.date?.slice(0, 10)}</TableCell>
                  <TableCell>{purchase.supplier?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {purchase.invoiceRef ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {purchase.items?.length ?? 0}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBdt(purchase.total)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PURCHASE_STATUS_VARIANT[purchase.status]}>
                      {PURCHASE_STATUS_LABELS[purchase.status]}
                    </Badge>
                    {purchase.voucherId && (
                      <div className="text-xs text-muted-foreground">Posted</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {purchase.status === "DRAFT" && (
                      <Can permission="inventory.purchase.receive">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReceiving(purchase)}
                        >
                          Receive
                        </Button>
                      </Can>
                    )}
                    {purchase.status === "RECEIVED" && (
                      <Can permission="inventory.purchase.cancel">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCancelling(purchase)}
                        >
                          Cancel
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <PurchaseDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      {receiving && (
        <ReceiveDialog
          purchase={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => {
            setReceiving(null);
            invalidate();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          purchase={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── the line grid ──────────────────────────────────────────────────────

function PurchaseDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceRef, setInvoiceRef] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { itemId: "", qty: "", unitPrice: "" },
  ]);

  const suppliers = useQuery({
    queryKey: ["inventory-suppliers"],
    queryFn: () => inventoryApi.listSuppliers({ limit: 100 }),
  });
  const items = useQuery({
    queryKey: ["inventory-items", "picker"],
    queryFn: () => inventoryApi.listItems({ limit: 200 }),
  });

  const byId = useMemo(
    () => new Map((items.data?.rows ?? []).map((item) => [item.id, item])),
    [items.data],
  );

  /**
   * Each line is rounded to the paisa BEFORE the sum, matching
   * `purchaseTotal` on the server. Summing exactly and rounding once
   * would differ by a paisa on inputs like 3 × 0.335, and the header
   * would then disagree with the stored line totals.
   */
  const total = lines.reduce((sum, line) => {
    const value = Number(line.qty) * Number(line.unitPrice);
    return Number.isFinite(value) ? sum + Math.round(value * 100) / 100 : sum;
  }, 0);

  const save = useMutation({
    mutationFn: () =>
      inventoryApi.createPurchase({
        supplierId: supplierId || undefined,
        date,
        invoiceRef: invoiceRef || undefined,
        lines: lines
          .filter((line) => line.itemId && Number(line.qty) > 0)
          .map((line) => ({
            itemId: line.itemId,
            qty: Number(line.qty),
            unitPrice: Number(line.unitPrice || 0),
          })),
      }),
    onSuccess: () => {
      toast.success("Draft saved — receive it to move the stock");
      onSaved();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const setLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New purchase</DialogTitle>
          <DialogDescription>
            Quantities are as the supplier&rsquo;s invoice writes them — in
            packs where an item has one. The store converts to base units.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="pur-supplier">Supplier</Label>
            <select
              id="pur-supplier"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Not recorded</option>
              {(suppliers.data?.rows ?? [])
                .filter((row) => row.status !== "BLACKLISTED")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pur-date">Date</Label>
            <Input
              id="pur-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pur-invoice">Invoice reference</Label>
            <Input
              id="pur-invoice"
              value={invoiceRef}
              onChange={(event) => setInvoiceRef(event.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead className="w-32">Unit price</TableHead>
                <TableHead className="w-32 text-right">Line total</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const item = byId.get(line.itemId);
                const lineTotal =
                  Math.round(Number(line.qty) * Number(line.unitPrice) * 100) /
                  100;
                return (
                  <TableRow key={index}>
                    <TableCell>
                      <select
                        aria-label={`Item for line ${index + 1}`}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={line.itemId}
                        onChange={(event) =>
                          setLine(index, { itemId: event.target.value })
                        }
                      >
                        <option value="">Choose…</option>
                        {(items.data?.rows ?? []).map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.code} — {row.name}
                          </option>
                        ))}
                      </select>
                      {item?.packSize && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          1 {item.packLabel ?? "pack"} ={" "}
                          {formatQty(item.packSize, item.unit)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Quantity for line ${index + 1}`}
                        type="number"
                        step="0.001"
                        value={line.qty}
                        onChange={(event) =>
                          setLine(index, { qty: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Unit price for line ${index + 1}`}
                        type="number"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(event) =>
                          setLine(index, { unitPrice: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {Number.isFinite(lineTotal) ? formatBdt(lineTotal) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() =>
                          setLines((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((prev) => [...prev, { itemId: "", qty: "", unitPrice: "" }])
            }
          >
            Add line
          </Button>
          <div className="text-sm">
            Total <span className="font-medium">{formatBdt(total)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              !lines.some((line) => line.itemId && Number(line.qty) > 0)
            }
          >
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── receive ────────────────────────────────────────────────────────────

function ReceiveDialog({
  purchase,
  onClose,
  onDone,
}: {
  purchase: Purchase;
  onClose: () => void;
  onDone: () => void;
}) {
  const [locationText, setLocationText] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [condition, setCondition] = useState<AssetCondition>("NEW");

  const assetLines = (purchase.items ?? []).filter(
    (line) => line.item.type === "ASSET",
  );
  const unitsToGenerate = assetLines.reduce(
    (total, line) => total + Math.round(Number(line.baseQty)),
    0,
  );

  const receive = useMutation({
    mutationFn: () =>
      inventoryApi.receivePurchase(purchase.id, {
        locationText: locationText || undefined,
        warrantyUntil: warrantyUntil || undefined,
        condition,
      }),
    onSuccess: (result) => {
      toast.success(
        result.assetUnitsGenerated > 0
          ? `Received — ${result.assetUnitsGenerated} tagged unit(s) created`
          : "Received into stock",
      );
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive {purchase.purchaseNo}</DialogTitle>
          <DialogDescription>
            This moves the stock, tags the assets and posts the voucher. A
            received delivery cannot be edited afterwards — the correction is
            a cancellation, which reverses the stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border p-3 text-sm">
          {(purchase.items ?? []).map((line) => (
            <div key={line.id} className="flex justify-between">
              <span>{line.item.name}</span>
              <span className="text-muted-foreground">
                {formatQty(line.baseQty, line.item.unit)}
                {Number(line.packSize) > 1
                  ? ` (${formatQty(line.qty)} × ${formatQty(line.packSize)})`
                  : ""}
              </span>
            </div>
          ))}
        </div>

        {unitsToGenerate > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {unitsToGenerate} tagged unit{unitsToGenerate === 1 ? "" : "s"}{" "}
              will be created and put in the store.
            </p>
            <div>
              <Label htmlFor="rcv-location">Where they will live</Label>
              <Input
                id="rcv-location"
                placeholder="Room 3, science store…"
                value={locationText}
                onChange={(event) => setLocationText(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rcv-warranty">Warranty until</Label>
                <Input
                  id="rcv-warranty"
                  type="date"
                  value={warrantyUntil}
                  onChange={(event) => setWarrantyUntil(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rcv-condition">Condition</Label>
                <select
                  id="rcv-condition"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={condition}
                  onChange={(event) =>
                    setCondition(event.target.value as AssetCondition)
                  }
                >
                  {ASSET_CONDITIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Not yet
          </Button>
          <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
            Receive into stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── cancel ─────────────────────────────────────────────────────────────

function CancelDialog({
  purchase,
  onClose,
  onDone,
}: {
  purchase: Purchase;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");

  const cancel = useMutation({
    mutationFn: () => inventoryApi.cancelPurchase(purchase.id, reason),
    onSuccess: (result) => {
      toast.success(
        result.voucherStanding
          ? "Cancelled and stock reversed — the posted voucher is left standing for the accountant"
          : "Cancelled",
      );
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {purchase.purchaseNo}</DialogTitle>
          <DialogDescription>
            This writes reversing entries rather than deleting the delivery —
            it happened, and the ledger keeps saying so. If the stock has
            already gone out, the reversal will be refused.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="cancel-reason">Reason</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Supplier delivered the wrong goods"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancel.mutate()}
            disabled={reason.trim().length < 3 || cancel.isPending}
          >
            Cancel the delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { Item };
