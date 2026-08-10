"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyticsApi,
  type ReportDefinition,
  type ReportFormat,
  type ReportPreview,
} from "@/lib/api/analytics";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  ReportParamsForm,
  toParamPayload,
  type ParamValues,
} from "./report-params";

/**
 * The in-place runner — roadmap §5's "catalog with param forms
 * auto-generated from params_schema, run → toast → export center", and the
 * gap M18 shipped with.
 *
 * Three buttons, and the difference between them is the point:
 *
 *   - **Preview** runs the report inline and shows the first hundred rows.
 *     It is how you find out you picked the wrong month before waiting for
 *     a file.
 *   - **Download now** renders and saves in the request. Small reports
 *     only; over the row cap the engine says so and points at Queue.
 *   - **Queue** is the roadmap's async path — the one that survives a
 *     50 000-row export, and the only one that puts a row in the export
 *     centre.
 */
export function RunReportDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ReportDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<ParamValues>({});
  const [format, setFormat] = useState<ReportFormat>("XLSX");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const queryClient = useQueryClient();

  const reset = (next: boolean) => {
    if (!next) {
      setValues({});
      setPreview(null);
    }
    onOpenChange(next);
  };

  const previewMutation = useMutation({
    mutationFn: () =>
      analyticsApi.preview(report!.code, { params: toParamPayload(values) }),
    onSuccess: setPreview,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const downloadMutation = useMutation({
    mutationFn: () =>
      analyticsApi.downloadNow(report!.code, {
        format,
        params: toParamPayload(values),
      }),
    onSuccess: () => toast.success("Downloaded"),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const queueMutation = useMutation({
    mutationFn: () =>
      analyticsApi.run(report!.code, {
        format,
        params: toParamPayload(values),
      }),
    onSuccess: () => {
      toast.success("Queued — it will appear in the export centre");
      void queryClient.invalidateQueries({ queryKey: ["report-runs"] });
      reset(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (!report) return null;
  const busy =
    previewMutation.isPending ||
    downloadMutation.isPending ||
    queueMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{report.name}</DialogTitle>
          <DialogDescription>{report.description}</DialogDescription>
        </DialogHeader>

        {report.freshness && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {report.freshness}
          </p>
        )}
        {report.columnsWillBeWithheld && (
          // Told before the download rather than discovered after it —
          // otherwise a short sheet reads as a broken export.
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Some columns of this report need the{" "}
            <code>{report.sensitivePermission}</code> permission and will be
            left out of your copy.
          </p>
        )}

        <ReportParamsForm
          params={report.params}
          values={values}
          onChange={setValues}
        />

        <div className="w-48 space-y-1.5">
          <Label htmlFor="report-format">Format</Label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as ReportFormat)}
          >
            <SelectTrigger id="report-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {report.formats.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preview && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{preview.title}</h3>
              <Badge variant="secondary">
                {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"}
              </Badge>
              {preview.truncated && (
                <span className="text-xs text-muted-foreground">
                  showing the first 100
                </span>
              )}
            </div>
            {preview.summary && preview.summary.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {preview.summary.map((item) => (
                  <span key={item.label}>
                    {item.label}:{" "}
                    <span className="font-medium text-foreground">
                      {String(item.value)}
                    </span>
                  </span>
                ))}
              </div>
            )}
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.key} className="px-2 py-1.5 text-left font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-t">
                      {preview.columns.map((c) => (
                        <td key={c.key} className="px-2 py-1 tabular-nums">
                          {formatCell(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.notes?.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </section>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Running…" : "Preview"}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => downloadMutation.mutate()}
            >
              Download now
            </Button>
            <Button disabled={busy} onClick={() => queueMutation.mutate()}>
              {queueMutation.isPending ? "Queueing…" : "Queue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  const text = String(value);
  // An ISO stamp in a preview cell is noise; the date is the fact.
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}
