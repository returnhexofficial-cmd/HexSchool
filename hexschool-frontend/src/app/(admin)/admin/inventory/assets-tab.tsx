"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
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
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANT,
  formatBdt,
  HOLDER_TYPE_LABELS,
  HOLDER_TYPES,
  inventoryApi,
  inventoryReportsApi,
  WARRANTY_VARIANT,
  type AssetStatus,
  type AssetUnit,
  type Holder,
  type HolderType,
} from "@/lib/api/inventory";

/**
 * The asset register: every tagged unit, where it is, who has it.
 *
 * Written-off units are **out of the counts and still in the list** when
 * the filter allows them (roadmap §6) — a school has to be able to say
 * what happened to the projector, and the one question an audit asks is
 * exactly the one dropping the rows would make unanswerable.
 */
export function AssetsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AssetStatus | "">("");
  const [search, setSearch] = useState("");
  const [onBooksOnly, setOnBooksOnly] = useState(true);
  const [assigning, setAssigning] = useState<AssetUnit | null>(null);
  const [disposing, setDisposing] = useState<AssetUnit | null>(null);

  const assets = useQuery({
    queryKey: ["inventory-assets", status, search, onBooksOnly],
    queryFn: () =>
      inventoryApi.listAssets({
        status: status || undefined,
        search: search || undefined,
        onBooksOnly: onBooksOnly || undefined,
        limit: 100,
      }),
  });

  const register = useQuery({
    queryKey: ["inventory-asset-register"],
    queryFn: () => inventoryReportsApi.assets(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-assets"] });
    void qc.invalidateQueries({ queryKey: ["inventory-asset-register"] });
  };

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "return" | "repair" | "repair-complete" }) =>
      action === "return"
        ? inventoryApi.returnAsset(id)
        : action === "repair"
          ? inventoryApi.repairAsset(id, {})
          : inventoryApi.completeRepair(id, {}),
    onSuccess: () => {
      toast.success("Register updated");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const counts = register.data?.counts;
  const rows = assets.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard title="On the books" value={String(counts?.onBooks ?? 0)} />
        <StatCard title="In store" value={String(counts?.inStore ?? 0)} />
        <StatCard title="Assigned" value={String(counts?.assigned ?? 0)} />
        <StatCard title="Under repair" value={String(counts?.underRepair ?? 0)} />
        <StatCard
          title="Written off"
          value={String((counts?.disposed ?? 0) + (counts?.lost ?? 0))}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="ast-search">Search</Label>
          <Input
            id="ast-search"
            placeholder="Tag, serial, location or item"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ast-status">Status</Label>
          <select
            id="ast-status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as AssetStatus | "")}
          >
            <option value="">All</option>
            {(Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).map((value) => (
              <option key={value} value={value}>
                {ASSET_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant={onBooksOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setOnBooksOnly((value) => !value)}
        >
          Hide written off
        </Button>
        <Can permission="inventory.export">
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void inventoryReportsApi.downloadAssetsPdf()}
          >
            Print check sheet
          </Button>
        </Can>
      </div>

      {assets.isLoading && <LoadingBlock />}
      {assets.isError && <ErrorState onRetry={() => void assets.refetch()} />}
      {assets.isSuccess && rows.length === 0 && (
        <EmptyState
          title="No tagged units"
          description="Assets are created when an asset purchase is received, or registered by hand for what the school already owns."
        />
      )}

      {assets.isSuccess && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Custodian</TableHead>
                <TableHead>Warranty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell className="font-mono text-xs">
                    {asset.assetTag}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{asset.item.name}</div>
                    {asset.serialNo && (
                      <div className="text-xs text-muted-foreground">
                        SN {asset.serialNo}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ASSET_STATUS_VARIANT[asset.status]}>
                      {ASSET_STATUS_LABELS[asset.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{asset.condition}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {asset.locationText ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {asset.custodianName ?? (
                      <span className="text-muted-foreground">In store</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={WARRANTY_VARIANT[asset.warranty.state]}>
                      {asset.warranty.state === "UNKNOWN"
                        ? "Not recorded"
                        : (asset.warranty.until ?? asset.warranty.state)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {asset.purchasePrice ? formatBdt(asset.purchasePrice) : "—"}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Can permission="inventory.asset.manage">
                      {asset.status === "IN_STORE" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAssigning(asset)}
                        >
                          Assign
                        </Button>
                      )}
                      {asset.status === "ASSIGNED" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAssigning(asset)}
                          >
                            Transfer
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              act.mutate({ id: asset.id, action: "return" })
                            }
                          >
                            To store
                          </Button>
                        </>
                      )}
                      {asset.status !== "UNDER_REPAIR" &&
                        asset.status !== "DISPOSED" &&
                        asset.status !== "LOST" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              act.mutate({ id: asset.id, action: "repair" })
                            }
                          >
                            Repair
                          </Button>
                        )}
                      {asset.status === "UNDER_REPAIR" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            act.mutate({
                              id: asset.id,
                              action: "repair-complete",
                            })
                          }
                        >
                          Back from repair
                        </Button>
                      )}
                    </Can>
                    <Can permission="inventory.asset.dispose">
                      {asset.status !== "DISPOSED" && asset.status !== "LOST" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDisposing(asset)}
                        >
                          Write off
                        </Button>
                      )}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {assigning && (
        <AssignDialog
          asset={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            invalidate();
          }}
        />
      )}

      {disposing && (
        <DisposeDialog
          asset={disposing}
          onClose={() => setDisposing(null)}
          onDone={() => {
            setDisposing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function AssignDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: AssetUnit;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<HolderType>("DEPARTMENT");
  const [departmentId, setDepartmentId] = useState("");
  const [personId, setPersonId] = useState("");
  const [room, setRoom] = useState("");
  const [locationText, setLocationText] = useState(asset.locationText ?? "");

  const holders = useQuery({
    queryKey: ["inventory-holders"],
    queryFn: () => inventoryApi.holders(),
  });

  const assign = useMutation({
    mutationFn: () => {
      const person = holders.data?.people.find((p) => p.personId === personId);
      const custodian: Holder = {
        type,
        departmentId: type === "DEPARTMENT" ? departmentId : undefined,
        personType: type === "PERSON" ? person?.personType : undefined,
        personId: type === "PERSON" ? personId : undefined,
        room: type === "ROOM" ? room : undefined,
      };
      return inventoryApi.assignAsset(asset.id, {
        custodian,
        locationText: locationText || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Custodian recorded");
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who will hold {asset.assetTag}?</DialogTitle>
          <DialogDescription>
            A department, a person or a room — shared lab equipment belongs to
            the department, not to whoever was standing nearest.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label htmlFor="assign-type">Kind</Label>
            <select
              id="assign-type"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value as HolderType)}
            >
              {HOLDER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {HOLDER_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="assign-target">Who</Label>
            {type === "DEPARTMENT" && (
              <select
                id="assign-target"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Choose…</option>
                {(holders.data?.departments ?? []).map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            )}
            {type === "PERSON" && (
              <select
                id="assign-target"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
              >
                <option value="">Choose…</option>
                {(holders.data?.people ?? []).map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.name} ({person.reference})
                  </option>
                ))}
              </select>
            )}
            {type === "ROOM" && (
              <Input
                id="assign-target"
                value={room}
                onChange={(event) => setRoom(event.target.value)}
              />
            )}
          </div>

          <div>
            <Label htmlFor="assign-location">Location note</Label>
            <Input
              id="assign-location"
              value={locationText}
              onChange={(event) => setLocationText(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => assign.mutate()} disabled={assign.isPending}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisposeDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: AssetUnit;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"DISPOSED" | "LOST">("DISPOSED");
  const [disposedAt, setDisposedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");

  const dispose = useMutation({
    mutationFn: () =>
      inventoryApi.disposeAsset(asset.id, { status, disposedAt, reason }),
    onSuccess: () => {
      toast.success("Written off — this cannot be undone");
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off {asset.assetTag}</DialogTitle>
          <DialogDescription>
            This is permanent. A unit that turns up later is registered as a
            new one with its own tag — the write-off keeps your name on it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="disp-status">What happened</Label>
              <select
                id="disp-status"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as "DISPOSED" | "LOST")
                }
              >
                <option value="DISPOSED">Disposed of</option>
                <option value="LOST">Cannot be found</option>
              </select>
            </div>
            <div>
              <Label htmlFor="disp-date">Date</Label>
              <Input
                id="disp-date"
                type="date"
                value={disposedAt}
                onChange={(event) => setDisposedAt(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="disp-reason">Reason</Label>
            <Input
              id="disp-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Beyond economic repair"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => dispose.mutate()}
            disabled={reason.trim().length < 3 || dispose.isPending}
          >
            Write it off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
