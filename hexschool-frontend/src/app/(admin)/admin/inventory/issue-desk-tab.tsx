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
  formatQty,
  HOLDER_TYPE_LABELS,
  HOLDER_TYPES,
  inventoryApi,
  ISSUE_STATUS_LABELS,
  type Holder,
  type HolderType,
  type IssuePreview,
  type IssueStatus,
  type StockIssue,
} from "@/lib/api/inventory";

interface DeskLine {
  itemId: string;
  qty: string;
}

/**
 * The issue desk: consumables going out, and coming back.
 *
 * **The Issue button is enabled by the server's verdict, not by anything
 * computed here.** `preview` calls the same `canIssue` the endpoint will,
 * so the greyed button, the red rows and the eventual 409 are three
 * renderings of one answer — the M16/M23/M25 single-verdict rule. The
 * client never decides whether there is enough stock.
 */
export function IssueDeskTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState<StockIssue | null>(null);

  const issues = useQuery({
    queryKey: ["inventory-issues", status],
    queryFn: () =>
      inventoryApi.listIssues({ status: status || undefined, limit: 100 }),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-issues"] });
    void qc.invalidateQueries({ queryKey: ["inventory-items"] });
    void qc.invalidateQueries({ queryKey: ["inventory-low-stock"] });
  };

  const rows = issues.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="iss-status">Status</Label>
          <select
            id="iss-status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as IssueStatus | "")}
          >
            <option value="">All</option>
            <option value="ISSUED">Out</option>
            <option value="PARTIAL_RETURN">Partly back</option>
            <option value="RETURNED">Returned</option>
          </select>
        </div>
        <Can permission="inventory.issue">
          <Button size="sm" className="ml-auto" onClick={() => setIssuing(true)}>
            Issue stock
          </Button>
        </Can>
      </div>

      {issues.isLoading && <LoadingBlock />}
      {issues.isError && <ErrorState onRetry={() => void issues.refetch()} />}
      {issues.isSuccess && rows.length === 0 && (
        <EmptyState
          title="Nothing has gone out yet"
          description="Issue consumables to a department, a person or a room."
        />
      )}

      {issues.isSuccess && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Issued to</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="font-mono text-xs">
                    {issue.issueNo}
                  </TableCell>
                  <TableCell>{issue.issueDate?.slice(0, 10)}</TableCell>
                  <TableCell>
                    <div>{issue.holderName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {HOLDER_TYPE_LABELS[issue.issuedToType]}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {issue.purpose ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {issue.items?.length ?? 0}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        issue.status === "RETURNED"
                          ? "secondary"
                          : issue.status === "PARTIAL_RETURN"
                            ? "outline"
                            : "default"
                      }
                    >
                      {ISSUE_STATUS_LABELS[issue.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {issue.status !== "RETURNED" && (
                      <Can permission="inventory.issue">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReturning(issue)}
                        >
                          Take back
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

      {issuing && (
        <IssueDialog
          onClose={() => setIssuing(false)}
          onDone={() => {
            setIssuing(false);
            invalidate();
          }}
        />
      )}

      {returning && (
        <ReturnDialog
          issue={returning}
          onClose={() => setReturning(null)}
          onDone={() => {
            setReturning(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── the desk ───────────────────────────────────────────────────────────

function IssueDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [issueDate, setIssueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [holderType, setHolderType] = useState<HolderType>("DEPARTMENT");
  const [departmentId, setDepartmentId] = useState("");
  const [personId, setPersonId] = useState("");
  const [room, setRoom] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<DeskLine[]>([{ itemId: "", qty: "" }]);
  const [preview, setPreview] = useState<IssuePreview | null>(null);

  const holders = useQuery({
    queryKey: ["inventory-holders"],
    queryFn: () => inventoryApi.holders(),
  });
  const items = useQuery({
    queryKey: ["inventory-issuable"],
    queryFn: () => inventoryApi.issuableItems(),
  });

  const byId = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, item])),
    [items.data],
  );

  const holder = (): Holder => {
    const person = holders.data?.people.find((p) => p.personId === personId);
    return {
      type: holderType,
      departmentId: holderType === "DEPARTMENT" ? departmentId : undefined,
      personType: holderType === "PERSON" ? person?.personType : undefined,
      personId: holderType === "PERSON" ? personId : undefined,
      room: holderType === "ROOM" ? room : undefined,
    };
  };

  const body = () => ({
    issueDate,
    issuedTo: holder(),
    purpose: purpose || undefined,
    lines: lines
      .filter((line) => line.itemId && Number(line.qty) > 0)
      .map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
  });

  const check = useMutation({
    mutationFn: () => inventoryApi.previewIssue(body()),
    onSuccess: setPreview,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const issue = useMutation({
    mutationFn: () => inventoryApi.createIssue(body()),
    onSuccess: (created) => {
      toast.success(`Issued as ${created.issueNo}`);
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const refusalFor = (itemId: string) =>
    preview?.refusals.find((refusal) => refusal.itemId === itemId);

  const hasLines = lines.some((line) => line.itemId && Number(line.qty) > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue stock</DialogTitle>
          <DialogDescription>
            Quantities are in each item&rsquo;s base unit. Check first — the
            server decides whether it can go out, and says why per line if it
            cannot.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="iss-date">Date</Label>
            <Input
              id="iss-date"
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="iss-holder">Issued to</Label>
            <select
              id="iss-holder"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={holderType}
              onChange={(event) => {
                setHolderType(event.target.value as HolderType);
                setPreview(null);
              }}
            >
              {HOLDER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {HOLDER_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="iss-target">Who</Label>
            {holderType === "DEPARTMENT" && (
              <select
                id="iss-target"
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
            {holderType === "PERSON" && (
              <select
                id="iss-target"
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
            {holderType === "ROOM" && (
              <Input
                id="iss-target"
                placeholder="Room 7"
                value={room}
                onChange={(event) => setRoom(event.target.value)}
              />
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="iss-purpose">Purpose</Label>
          <Input
            id="iss-purpose"
            placeholder="Term supplies"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead className="w-32 text-right">On hand</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const item = byId.get(line.itemId);
                const refusal = refusalFor(line.itemId);
                return (
                  <TableRow
                    key={index}
                    className={refusal ? "bg-destructive/5" : undefined}
                  >
                    <TableCell>
                      <select
                        aria-label={`Item for line ${index + 1}`}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={line.itemId}
                        onChange={(event) => {
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, itemId: event.target.value } : l,
                            ),
                          );
                          setPreview(null);
                        }}
                      >
                        <option value="">Choose…</option>
                        {(items.data ?? []).map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.code} — {row.name}
                          </option>
                        ))}
                      </select>
                      {refusal && (
                        <p className="mt-1 text-xs text-destructive">
                          {refusal.reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Quantity for line ${index + 1}`}
                        type="number"
                        step="0.001"
                        value={line.qty}
                        onChange={(event) => {
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === index ? { ...l, qty: event.target.value } : l,
                            ),
                          );
                          setPreview(null);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {item ? formatQty(item.available, item.unit) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() => {
                          setLines((prev) => prev.filter((_, i) => i !== index));
                          setPreview(null);
                        }}
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

        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setLines((prev) => [...prev, { itemId: "", qty: "" }])}
        >
          Add line
        </Button>

        {preview && !preview.allowed && (
          <p className="text-sm text-destructive">
            This slip cannot go out as entered — {preview.refusals.length}{" "}
            problem{preview.refusals.length === 1 ? "" : "s"} above.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => check.mutate()}
            disabled={!hasLines || check.isPending}
          >
            Check
          </Button>
          <Button
            onClick={() => issue.mutate()}
            // Enabled by the SERVER's verdict, never by a client-side sum.
            disabled={!preview?.allowed || issue.isPending}
          >
            Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── returns ────────────────────────────────────────────────────────────

function ReturnDialog({
  issue,
  onClose,
  onDone,
}: {
  issue: StockIssue;
  onClose: () => void;
  onDone: () => void;
}) {
  const outstanding = new Map(
    issue.outstanding.map((row) => [row.issueItemId, row.outstanding]),
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      issue.outstanding.map((row) => [row.issueItemId, String(row.outstanding)]),
    ),
  );

  const submit = useMutation({
    mutationFn: () =>
      inventoryApi.returnIssue(issue.id, {
        lines: Object.entries(quantities)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([issueItemId, qty]) => ({ issueItemId, qty: Number(qty) })),
      }),
    onSuccess: (updated) => {
      toast.success(
        updated.status === "RETURNED"
          ? "Everything is back"
          : "Recorded — the rest is still out",
      );
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take back against {issue.issueNo}</DialogTitle>
          <DialogDescription>
            A return may not exceed what is still out on a line. The slip
            becomes &ldquo;returned&rdquo; only when every line is fully back.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {issue.items
            .filter((line) => (outstanding.get(line.id) ?? 0) > 0)
            .map((line) => (
              <div key={line.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{line.item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatQty(outstanding.get(line.id) ?? 0, line.item.unit)}{" "}
                    still out
                  </div>
                </div>
                <Input
                  aria-label={`Return quantity for ${line.item.name}`}
                  className="w-28"
                  type="number"
                  step="0.001"
                  value={quantities[line.id] ?? ""}
                  onChange={(event) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [line.id]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            Record the return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
