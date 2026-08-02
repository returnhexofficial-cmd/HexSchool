"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
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
  formatBdt,
  formatQty,
  inventoryApi,
  inventoryReportsApi,
  TXN_LABELS,
  WARRANTY_VARIANT,
} from "@/lib/api/inventory";

const REPORTS = [
  ["stock", "Stock & valuation"],
  ["ledger", "Item ledger"],
  ["purchases", "Purchases"],
  ["warranty", "Warranties"],
  ["consumption", "Consumption"],
] as const;

type ReportKey = (typeof REPORTS)[number][0];

/**
 * The six reports, plus the stock-take wizard that turns a count sheet
 * into adjustments (roadmap §8).
 *
 * The valuation prints **its own method** beside the total. A number
 * labelled "total stock value" with no basis on the page is read as FIFO
 * by whoever opens it next, and this one is not FIFO.
 */
export function InventoryReportsTab() {
  const [report, setReport] = useState<ReportKey>("stock");
  const [counting, setCounting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REPORTS.map(([key, label]) => (
          <Button
            key={key}
            variant={report === key ? "default" : "outline"}
            size="sm"
            onClick={() => setReport(key)}
          >
            {label}
          </Button>
        ))}
        <Can permission="inventory.adjust">
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => setCounting(true)}
          >
            Stock take
          </Button>
        </Can>
      </div>

      {report === "stock" && <StockReport />}
      {report === "ledger" && <LedgerReport />}
      {report === "purchases" && <PurchasesReport />}
      {report === "warranty" && <WarrantyReport />}
      {report === "consumption" && <ConsumptionReport />}

      {counting && <StockTakeDialog onClose={() => setCounting(false)} />}
    </div>
  );
}

function StockReport() {
  const query = useQuery({
    queryKey: ["inventory-report-stock"],
    queryFn: () => inventoryReportsApi.stock(),
  });

  if (query.isLoading) return <LoadingBlock />;
  const report = query.data;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Items in stock" value={String(report.itemsInStock)} />
        <StatCard title="Below reorder" value={String(report.belowReorder)} />
        <StatCard title="Total value" value={formatBdt(report.totalValue)} />
        <StatCard title="Unpriced items" value={String(report.unvaluedItems)} />
      </div>

      {/* The method, on the page. */}
      <p className="text-xs text-muted-foreground">
        Valued on <span className="font-medium">{report.valuationMethod}</span>.{" "}
        {report.valuationNote}
      </p>

      <div className="flex justify-end">
        <Can permission="inventory.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void inventoryReportsApi.downloadStock()}
          >
            Export
          </Button>
        </Can>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Last cost</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row) => (
              <TableRow key={row.itemId}>
                <TableCell className="font-mono text-xs">{row.itemCode}</TableCell>
                <TableCell>{row.itemName}</TableCell>
                <TableCell>{row.categoryName ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <span className={row.belowReorder ? "text-destructive" : ""}>
                    {formatQty(row.balance, row.unit)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {row.lastUnitCost === null ? "—" : formatBdt(row.lastUnitCost)}
                </TableCell>
                <TableCell className="text-right">
                  {row.value === null ? (
                    <span className="text-muted-foreground">not priced</span>
                  ) : (
                    formatBdt(row.value)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LedgerReport() {
  const [itemId, setItemId] = useState("");

  const items = useQuery({
    queryKey: ["inventory-items", "ledger-picker"],
    queryFn: () => inventoryApi.listItems({ limit: 200 }),
  });
  const ledger = useQuery({
    queryKey: ["inventory-report-ledger", itemId],
    queryFn: () => inventoryReportsApi.itemLedger(itemId),
    enabled: Boolean(itemId),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="min-w-[260px]">
          <Label htmlFor="led-item">Item</Label>
          <select
            id="led-item"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
          >
            <option value="">Choose an item…</option>
            {(items.data?.rows ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.name}
              </option>
            ))}
          </select>
        </div>
        {itemId && (
          <Can permission="inventory.export">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void inventoryReportsApi.downloadItemLedger(itemId)}
            >
              Export
            </Button>
          </Can>
        )}
      </div>

      {!itemId && (
        <EmptyState
          title="Pick an item"
          description="Every movement of it, in and out, with the running balance beside each row."
        />
      )}

      {ledger.isLoading && itemId && <LoadingBlock />}

      {ledger.data && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              title="Balance now"
              value={formatQty(ledger.data.balance, ledger.data.item.unit)}
            />
            <StatCard
              title="Movements"
              value={String(ledger.data.rows.length)}
            />
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TXN_LABELS[row.txn]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.qtyIn > 0 ? formatQty(row.qtyIn) : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.qtyOut > 0 ? formatQty(row.qtyOut) : ""}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatQty(row.balanceAfter)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.remarks ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function PurchasesReport() {
  const query = useQuery({
    queryKey: ["inventory-report-purchases"],
    queryFn: () => inventoryReportsApi.purchases(),
  });

  if (query.isLoading) return <LoadingBlock />;
  const report = query.data;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard title="Deliveries received" value={String(report.purchases)} />
        <StatCard title="Total spent" value={formatBdt(report.total)} />
      </div>

      <div className="flex justify-end">
        <Can permission="inventory.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void inventoryReportsApi.downloadPurchases()}
          >
            Export
          </Button>
        </Can>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Deliveries</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.bySupplier.map((row) => (
              <TableRow key={row.supplierId ?? "none"}>
                <TableCell>{row.supplierName}</TableCell>
                <TableCell className="text-right">{row.purchases}</TableCell>
                <TableCell className="text-right">
                  {formatBdt(row.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WarrantyReport() {
  const query = useQuery({
    queryKey: ["inventory-report-warranty"],
    queryFn: () => inventoryReportsApi.warranty(),
  });

  if (query.isLoading) return <LoadingBlock />;
  const report = query.data;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Anything lapsed, lapsing within {report.windowDays} days, or with no
        warranty date recorded at all — the last is not the same as covered.
      </p>

      <div className="flex justify-end">
        <Can permission="inventory.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void inventoryReportsApi.downloadWarranty()}
          >
            Export
          </Button>
        </Can>
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title="Nothing needs attention"
          description="Every asset on the books is inside its warranty."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Until</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    {row.assetTag}
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.location ?? "—"}
                  </TableCell>
                  <TableCell>{row.warrantyUntil ?? "not recorded"}</TableCell>
                  <TableCell>
                    <Badge variant={WARRANTY_VARIANT[row.state]}>
                      {row.message ?? row.state}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ConsumptionReport() {
  const query = useQuery({
    queryKey: ["inventory-report-consumption"],
    queryFn: () => inventoryReportsApi.consumption(),
  });

  if (query.isLoading) return <LoadingBlock />;
  const report = query.data;
  if (!report) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        What each department, person and room actually used — net of anything
        they sent back.
      </p>

      <div className="flex justify-end">
        <Can permission="inventory.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void inventoryReportsApi.downloadConsumption()}
          >
            Export
          </Button>
        </Can>
      </div>

      {report.groups.length === 0 ? (
        <EmptyState
          title="Nothing consumed in this window"
          description="Issue slips that were fully returned do not count as consumption."
        />
      ) : (
        <div className="space-y-3">
          {report.groups.map((group) => (
            <div key={group.holderKey} className="rounded-md border p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{group.holder}</span>
                <span className="text-sm">{formatBdt(group.value)}</span>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                {group.items.map((item) => (
                  <div key={item.itemId} className="flex justify-between">
                    <span>{item.itemName}</span>
                    <span>
                      {formatQty(item.quantity)} · {formatBdt(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the stock-take wizard (roadmap §8) ─────────────────────────────────

/**
 * A count sheet, entered as **what is on the shelf** rather than as a
 * difference. The server works out which way each item moved, and drops
 * the rows that already match — a four-hundred-item count should show the
 * eleven real discrepancies, not four hundred zeroes.
 */
function StockTakeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});

  const items = useQuery({
    queryKey: ["inventory-items", "count-sheet"],
    queryFn: () => inventoryApi.listItems({ type: "CONSUMABLE", limit: 200 }),
  });

  const submit = useMutation({
    mutationFn: () =>
      inventoryApi.adjust({
        reason,
        lines: Object.entries(counts)
          .filter(([, value]) => value !== "")
          .map(([itemId, value]) => ({ itemId, countedQty: Number(value) })),
      }),
    onSuccess: (result) => {
      toast.success(
        result.message ??
          `${result.adjusted.length} item(s) corrected against the count`,
      );
      void qc.invalidateQueries({ queryKey: ["inventory-items"] });
      void qc.invalidateQueries({ queryKey: ["inventory-report-stock"] });
      void qc.invalidateQueries({ queryKey: ["inventory-low-stock"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock take</DialogTitle>
          <DialogDescription>
            Enter what is actually on the shelf. Leave a row blank to skip it —
            items whose count already matches are not touched.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="take-reason">Reason</Label>
          <Input
            id="take-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="March physical count"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ledger says</TableHead>
                <TableHead className="w-32">Counted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items.data?.rows ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.code}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatQty(item.balance, item.unit)}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Counted quantity for ${item.name}`}
                      type="number"
                      step="0.001"
                      value={counts[item.id] ?? ""}
                      onChange={(event) =>
                        setCounts((prev) => ({
                          ...prev,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={
              reason.trim().length < 3 ||
              Object.values(counts).every((value) => value === "") ||
              submit.isPending
            }
          >
            Apply the count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
