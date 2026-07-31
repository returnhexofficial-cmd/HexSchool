"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatBdt,
  formatLibraryDate,
  libraryReportApi,
  stockCheckApi,
  normalizeScan,
} from "@/lib/api/library";

const VIEWS = [
  ["overdue", "Overdue"],
  ["popular", "Popular titles"],
  ["stock", "Category stock"],
  ["verify", "Stock verification"],
] as const;

type View = (typeof VIEWS)[number][0];

export function ReportsTab() {
  const [view, setView] = useState<View>("overdue");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {VIEWS.map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={view === key ? "secondary" : "ghost"}
            onClick={() => setView(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {view === "overdue" && <OverdueReport />}
      {view === "popular" && <PopularReport />}
      {view === "stock" && <StockReport />}
      {view === "verify" && <StockVerification />}
    </div>
  );
}

function OverdueReport() {
  const list = useQuery({
    queryKey: ["library-report-overdue"],
    queryFn: () => libraryReportApi.overdue(),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="library.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void libraryReportApi.downloadOverdue()}
          >
            Export XLSX
          </Button>
        </Can>
      </div>
      {(list.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing overdue"
          description="Every book is back or still inside its loan period."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Accession</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Class / role</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Fine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((row) => (
                <TableRow key={row.issueId}>
                  <TableCell className="font-mono text-xs">
                    {row.accessionNo}
                  </TableCell>
                  <TableCell className="text-sm">{row.title}</TableCell>
                  <TableCell className="text-sm">
                    {row.memberName}
                    <div className="text-xs text-muted-foreground">
                      {row.cardNo}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.memberContext ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatLibraryDate(row.dueAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="destructive">{row.daysOverdue}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatBdt(row.outstandingFine)}
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

function PopularReport() {
  const list = useQuery({
    queryKey: ["library-report-popular"],
    queryFn: () => libraryReportApi.popular({ limit: 25 }),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const max = Math.max(1, ...(list.data ?? []).map((row) => row.issues));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Most-borrowed titles over the last 30 days.
        </p>
        <Can permission="library.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void libraryReportApi.downloadPopular()}
          >
            Export XLSX
          </Button>
        </Can>
      </div>
      {(list.data ?? []).length === 0 ? (
        <EmptyState
          title="No loans in the window"
          description="Nothing has been borrowed in the last 30 days."
        />
      ) : (
        <div className="space-y-2">
          {(list.data ?? []).map((row) => (
            <div key={row.bookId} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{row.title}</span>
                <span className="text-muted-foreground">
                  {row.issues} loan(s)
                </span>
              </div>
              {/* A plain bar rather than a chart: one number per row, and
                  the comparison that matters is against the top title. */}
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${(row.issues / max) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {[row.category, row.authors.join(", ")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StockReport() {
  const report = useQuery({
    queryKey: ["library-report-stock"],
    queryFn: () => libraryReportApi.stock(),
  });

  if (report.isLoading) return <LoadingBlock />;
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {report.data?.inStock ?? 0} copies in stock ·{" "}
          {report.data?.writtenOff ?? 0} written off (lost, damaged or
          withdrawn — excluded from the stock count).
        </p>
        <Can permission="library.export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void libraryReportApi.downloadStock()}
          >
            Export XLSX
          </Button>
        </Can>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Titles</TableHead>
              <TableHead className="text-right">Copies</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">On loan</TableHead>
              <TableHead className="text-right">Written off</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report.data?.byCategory ?? []).map((row) => (
              <TableRow key={row.categoryId}>
                <TableCell className="text-sm font-medium">
                  {row.categoryName}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.titles}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.copies}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.available}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.issued}
                </TableCell>
                <TableCell className="text-right text-sm">{row.lost}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Roadmap §4's "physical verification mode: scan-all, diff report".
 *
 * Open a count, walk the shelves scanning, close it. The scan box takes
 * one code per Enter — which is exactly what a USB scanner produces, so
 * the librarian never touches the keyboard between books.
 */
function StockVerification() {
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [name, setName] = useState("");
  const [rackNo, setRackNo] = useState("");
  const [notes, setNotes] = useState("");

  const list = useQuery({
    queryKey: ["library-stock-checks"],
    queryFn: () => stockCheckApi.list({ limit: 20 }),
  });

  const open = (list.data?.rows ?? []).find(
    (row) => row.status === "IN_PROGRESS",
  );

  const diff = useQuery({
    queryKey: ["library-stock-diff", open?.id],
    queryFn: () => stockCheckApi.diff(open!.id),
    enabled: Boolean(open),
  });

  const start = useMutation({
    mutationFn: () =>
      stockCheckApi.start({
        name: name.trim(),
        rackNo: rackNo.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Count opened — start scanning.");
      setName("");
      setRackNo("");
      void qc.invalidateQueries({ queryKey: ["library-stock-checks"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const record = useMutation({
    mutationFn: (code: string) => stockCheckApi.scan(open!.id, [code]),
    onSuccess: (result) => {
      if (result.unknown > 0) {
        toast.warning("Recorded — that code is not in the catalogue.");
      }
      void qc.invalidateQueries({ queryKey: ["library-stock-checks"] });
      void qc.invalidateQueries({ queryKey: ["library-stock-diff"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const close = useMutation({
    mutationFn: () => stockCheckApi.close(open!.id, notes.trim() || undefined),
    onSuccess: (result) => {
      toast.success(
        `Count closed — ${result.diff.missing.length} missing, ${result.diff.unexpected.length} unexpected.`,
      );
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["library-stock-checks"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (list.isLoading) return <LoadingBlock />;

  if (!open) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
          <div className="w-56 space-y-1">
            <Label htmlFor="check-name">Name the count</Label>
            <Input
              id="check-name"
              placeholder="Annual stock-take 2026"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor="check-rack">Rack (optional)</Label>
            <Input
              id="check-rack"
              placeholder="A1"
              value={rackNo}
              onChange={(event) => setRackNo(event.target.value)}
            />
          </div>
          <Can permission="library.stock.verify">
            <Button
              disabled={name.trim().length < 2 || start.isPending}
              onClick={() => start.mutate()}
            >
              Start counting
            </Button>
          </Can>
        </div>

        <p className="text-xs text-muted-foreground">
          A book on loan is legitimately not on the shelf, so it is never
          counted as missing. One rack at a time is fine — a book from
          another rack shows up as <em>misplaced</em> rather than as an
          error.
        </p>

        {(list.data?.rows ?? []).length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Count</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Scanned</TableHead>
                  <TableHead className="text-right">Missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data?.rows ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm font-medium">
                      {row.name}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.rackNo ?? "Whole library"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.completedAt
                        ? formatLibraryDate(row.completedAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.expectedCount}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.scannedCount}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.missingCount > 0 ? (
                        <Badge variant="destructive">{row.missingCount}</Badge>
                      ) : (
                        "—"
                      )}
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

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-72 space-y-1">
            <Label htmlFor="scan-box">
              Scan a book ({open.name}
              {open.rackNo ? ` · rack ${open.rackNo}` : ""})
            </Label>
            <Input
              id="scan-box"
              autoFocus
              placeholder="Accession number, then Enter"
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={(event) => {
                // A USB scanner types the code and presses Enter. That is
                // the whole interaction — no button, no mouse.
                if (event.key !== "Enter") return;
                event.preventDefault();
                const code = normalizeScan(scan);
                if (code.length === 0) return;
                record.mutate(code);
                setScan("");
              }}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {diff.data?.scannedCount ?? 0} scanned ·{" "}
            {diff.data?.expectedCount ?? 0} expected
          </div>
        </div>
      </div>

      {diff.data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <DiffPanel
            title={`Missing (${diff.data.missing.length})`}
            rows={diff.data.missing.map(
              (row) => `${row.accessionNo} — ${row.bookTitle}`,
            )}
            empty="Nothing missing so far."
            tone="destructive"
          />
          <DiffPanel
            title={`Unexpected (${diff.data.unexpected.length})`}
            rows={diff.data.unexpected.map(
              (row) =>
                `${row.accessionNo} — ${
                  row.reason === "ON_LOAN"
                    ? "recorded as on loan"
                    : row.reason === "UNKNOWN"
                      ? "not in the catalogue"
                      : "out of circulation"
                }`,
            )}
            empty="Nothing unexpected."
          />
          <DiffPanel
            title={`Misplaced (${diff.data.misplaced.length})`}
            rows={diff.data.misplaced.map(
              (row) => `${row.accessionNo} — ${row.bookTitle}`,
            )}
            empty="Everything is on the right rack."
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <div className="flex-1 space-y-1">
          <Label htmlFor="close-notes">Notes</Label>
          <Textarea
            id="close-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <Can permission="library.stock.verify">
          <Button onClick={() => close.mutate()} disabled={close.isPending}>
            Close the count
          </Button>
        </Can>
      </div>
      <p className="text-xs text-muted-foreground">
        The diff is computed and frozen when the count closes, so a book
        issued during the week is not reported missing — and reopening the
        report months later still shows what was actually found.
      </p>
    </div>
  );
}

function DiffPanel({
  title,
  rows,
  empty,
  tone,
}: {
  title: string;
  rows: string[];
  empty: string;
  tone?: "destructive";
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <h3
        className={
          tone === "destructive"
            ? "text-sm font-medium text-destructive"
            : "text-sm font-medium"
        }
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
          {rows.map((row) => (
            <li key={row} className="font-mono">
              {row}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
