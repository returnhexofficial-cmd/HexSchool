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
  formatBdt,
  formatQty,
  inventoryApi,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  ITEM_UNITS,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUSES,
  type CategoryNode,
  type Item,
  type ItemInput,
  type ItemType,
  type ItemUnit,
  type Supplier,
  type SupplierInput,
  type SupplierStatus,
} from "@/lib/api/inventory";

/**
 * The catalogue: what the school stocks, how it is filed, and who it buys
 * from.
 *
 * The balance column is the one worth pointing at — it comes from the
 * stock ledger on every read, because there is **no quantity column on an
 * item**. That is why nothing on this screen can edit a balance, and why
 * a correction has to go through the adjustment dialog with a reason on
 * it.
 */
export function CatalogTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ItemType | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const items = useQuery({
    queryKey: ["inventory-items", search, type, categoryId, lowOnly],
    queryFn: () =>
      inventoryApi.listItems({
        search: search || undefined,
        type: type || undefined,
        categoryId: categoryId || undefined,
        lowStock: lowOnly || undefined,
        limit: 100,
      }),
  });

  const categories = useQuery({
    queryKey: ["inventory-categories"],
    queryFn: inventoryApi.categoryTree,
  });

  const remove = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteItem(id),
    onSuccess: () => {
      toast.success("Item removed from the catalogue");
      setDeletingItem(null);
      void qc.invalidateQueries({ queryKey: ["inventory-items"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const flatCategories = flatten(categories.data ?? []);
  const rows = items.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Items" value={String(items.data?.total ?? 0)} />
        <StatCard
          title="At or below reorder level"
          value={String(rows.filter((row) => row.belowReorder).length)}
        />
        <StatCard title="Categories" value={String(flatCategories.length)} />
        <StatCard
          title="Assets in the catalogue"
          value={String(rows.filter((row) => row.type === "ASSET").length)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="inv-search">Search</Label>
          <Input
            id="inv-search"
            placeholder="Name or code"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="inv-type">Type</Label>
          <select
            id="inv-type"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value as ItemType | "")}
          >
            <option value="">All</option>
            {ITEM_TYPES.map((value) => (
              <option key={value} value={value}>
                {ITEM_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="inv-cat">Category</Label>
          <select
            id="inv-cat"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All</option>
            {flatCategories.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant={lowOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setLowOnly((value) => !value)}
        >
          Low stock only
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCategories(true)}>
            Categories
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSuppliers(true)}>
            Suppliers
          </Button>
          <Can permission="inventory.catalog.manage">
            <Button size="sm" onClick={() => setCreatingItem(true)}>
              New item
            </Button>
          </Can>
        </div>
      </div>

      {items.isLoading && <LoadingBlock />}
      {items.isError && <ErrorState onRetry={() => void items.refetch()} />}
      {items.isSuccess && rows.length === 0 && (
        <EmptyState
          title="Nothing in the catalogue yet"
          description="Add the stationery, furniture and equipment the school keeps."
        />
      )}

      {items.isSuccess && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">In stock</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead className="text-right">Last cost</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    {item.packLabel && (
                      <div className="text-xs text-muted-foreground">
                        {item.packLabel}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{item.categoryName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={item.type === "ASSET" ? "default" : "secondary"}>
                      {item.type === "ASSET" ? "Asset" : "Consumable"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={item.belowReorder ? "font-medium text-destructive" : ""}>
                      {formatQty(item.balance, item.unit)}
                    </span>
                    {item.balanceInPacks !== null && (
                      <div className="text-xs text-muted-foreground">
                        {formatQty(item.balanceInPacks)} {item.packLabel ?? "packs"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {item.reorderLevel === null
                      ? "—"
                      : formatQty(item.reorderLevel)}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.lastUnitCost === null
                      ? "—"
                      : formatBdt(item.lastUnitCost)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="inventory.catalog.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingItem(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingItem(item)}
                      >
                        Remove
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(creatingItem || editingItem) && (
        <ItemDialog
          item={editingItem}
          categories={flatCategories}
          onClose={() => {
            setCreatingItem(false);
            setEditingItem(null);
          }}
          onSaved={() => {
            setCreatingItem(false);
            setEditingItem(null);
            void qc.invalidateQueries({ queryKey: ["inventory-items"] });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletingItem)}
        title={`Remove ${deletingItem?.name ?? ""}?`}
        description="An item with stock movements behind it cannot be removed — the ledger would stop being readable."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deletingItem) remove.mutate(deletingItem.id);
        }}
        onOpenChange={(open) => !open && setDeletingItem(null)}
      />

      {showCategories && (
        <CategoriesDialog onClose={() => setShowCategories(false)} />
      )}
      {showSuppliers && <SuppliersDialog onClose={() => setShowSuppliers(false)} />}
    </div>
  );
}

// ── item dialog ────────────────────────────────────────────────────────

function ItemDialog({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: Item | null;
  categories: Array<{ id: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ItemInput>({
    code: item?.code ?? "",
    name: item?.name ?? "",
    type: item?.type ?? "CONSUMABLE",
    unit: item?.unit ?? "PCS",
    categoryId: item?.categoryId ?? undefined,
    packSize: item?.packSize ? Number(item.packSize) : undefined,
    packLabel: item?.packLabel ?? undefined,
    reorderLevel: item?.reorderLevel ? Number(item.reorderLevel) : undefined,
  });

  const save = useMutation({
    mutationFn: (body: ItemInput) =>
      item ? inventoryApi.updateItem(item.id, body) : inventoryApi.createItem(body),
    onSuccess: () => {
      toast.success(item ? "Item updated" : "Item added");
      onSaved();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = <K extends keyof ItemInput>(key: K, value: ItemInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>
            An asset is tagged one unit at a time; a consumable is counted.
            The type cannot change once stock has moved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="item-code">Code</Label>
              <Input
                id="item-code"
                value={form.code}
                onChange={(event) => set("code", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="item-type">Type</Label>
              <select
                id="item-type"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.type}
                onChange={(event) => set("type", event.target.value as ItemType)}
              >
                {ITEM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {ITEM_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="item-unit">Base unit</Label>
              <select
                id="item-unit"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.unit}
                onChange={(event) => set("unit", event.target.value as ItemUnit)}
              >
                {ITEM_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="item-cat">Category</Label>
              <select
                id="item-cat"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.categoryId ?? ""}
                onChange={(event) =>
                  set("categoryId", event.target.value || undefined)
                }
              >
                <option value="">Uncategorised</option>
                {categories.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="item-pack">Base units per pack</Label>
              <Input
                id="item-pack"
                type="number"
                step="0.001"
                placeholder="Leave empty if unpacked"
                value={form.packSize ?? ""}
                onChange={(event) =>
                  set(
                    "packSize",
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A ream is 500 sheets, a box is 12 pens. Buy in packs, issue in
                base units.
              </p>
            </div>
            <div>
              <Label htmlFor="item-packlabel">Pack name</Label>
              <Input
                id="item-packlabel"
                placeholder="Box of 12"
                value={form.packLabel ?? ""}
                onChange={(event) =>
                  set("packLabel", event.target.value || undefined)
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="item-reorder">Reorder level</Label>
            <Input
              id="item-reorder"
              type="number"
              step="0.001"
              placeholder="Leave empty for no alerts"
              value={form.reorderLevel ?? ""}
              onChange={(event) =>
                set(
                  "reorderLevel",
                  event.target.value ? Number(event.target.value) : undefined,
                )
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Empty means &ldquo;do not tell me about this item&rdquo; — which
              is not the same as zero.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {item ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── categories ─────────────────────────────────────────────────────────

function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");

  const categories = useQuery({
    queryKey: ["inventory-categories"],
    queryFn: inventoryApi.categoryTree,
  });

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createCategory({ name, parentId: parentId || undefined }),
    onSuccess: () => {
      toast.success("Category added");
      setName("");
      void qc.invalidateQueries({ queryKey: ["inventory-categories"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteCategory(id),
    onSuccess: () => {
      toast.success("Category removed");
      void qc.invalidateQueries({ queryKey: ["inventory-categories"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const flat = flatten(categories.data ?? []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Item categories</DialogTitle>
          <DialogDescription>
            A tree, because a store is naturally nested. Categories are also
            what the accounting posting map keys on.
          </DialogDescription>
        </DialogHeader>

        <Can permission="inventory.catalog.manage">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cat-parent">Inside</Label>
              <select
                id="cat-parent"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Top level</option>
                {flat.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!name.trim() || create.isPending}
            >
              Add
            </Button>
          </div>
        </Can>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {flat.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <span>{node.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {node.itemCount} item{node.itemCount === 1 ? "" : "s"}
                </span>
                <Can permission="inventory.catalog.manage">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(node.id)}
                  >
                    Remove
                  </Button>
                </Can>
              </span>
            </div>
          ))}
          {flat.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No categories yet.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── suppliers ──────────────────────────────────────────────────────────

function SuppliersDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SupplierInput>({ name: "" });

  const suppliers = useQuery({
    queryKey: ["inventory-suppliers"],
    queryFn: () => inventoryApi.listSuppliers({ limit: 100 }),
  });

  const create = useMutation({
    mutationFn: () => inventoryApi.createSupplier(form),
    onSuccess: () => {
      toast.success("Supplier added");
      setForm({ name: "" });
      void qc.invalidateQueries({ queryKey: ["inventory-suppliers"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const setStatus = useMutation({
    mutationFn: ({ row, status }: { row: Supplier; status: SupplierStatus }) =>
      inventoryApi.updateSupplier(row.id, {
        name: row.name,
        contactPerson: row.contactPerson ?? undefined,
        phone: row.phone ?? undefined,
        status,
        statusReason:
          status === "BLACKLISTED"
            ? (row.statusReason ?? "Recorded from the supplier list")
            : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory-suppliers"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suppliers</DialogTitle>
          <DialogDescription>
            A name and a number to ring when the delivery is short. A
            blacklisted supplier is refused on the next purchase, with the
            reason shown.
          </DialogDescription>
        </DialogHeader>

        <Can permission="inventory.catalog.manage">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="sup-name">Name</Label>
              <Input
                id="sup-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="sup-phone">Phone</Label>
              <Input
                id="sup-phone"
                value={form.phone ?? ""}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    phone: event.target.value || undefined,
                  }))
                }
              />
            </div>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              Add
            </Button>
          </div>
        </Can>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(suppliers.data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.contactPerson ?? "—"}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === "BLACKLISTED"
                          ? "destructive"
                          : row.status === "ACTIVE"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {SUPPLIER_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.statusReason && (
                      <div className="text-xs text-muted-foreground">
                        {row.statusReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="inventory.catalog.manage">
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={row.status}
                        onChange={(event) =>
                          setStatus.mutate({
                            row,
                            status: event.target.value as SupplierStatus,
                          })
                        }
                      >
                        {SUPPLIER_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {SUPPLIER_STATUS_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Depth-first walk producing indented labels for the flat pickers. */
export function flatten(
  nodes: CategoryNode[],
  depth = 0,
): Array<{ id: string; label: string; itemCount: number }> {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      label: `${"— ".repeat(depth)}${node.name}`,
      itemCount: node.itemCount,
    },
    ...flatten(node.children, depth + 1),
  ]);
}
