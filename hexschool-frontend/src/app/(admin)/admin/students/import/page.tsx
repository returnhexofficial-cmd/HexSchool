"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/api/auth";
import { studentsApi, type ImportReport } from "@/lib/api/students";

export default function StudentImportPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const downloadTemplate = useMutation({
    mutationFn: () => studentsApi.downloadImportTemplate(),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const dryRun = useMutation({
    mutationFn: () => studentsApi.import(file!, false),
    onSuccess: (r) => {
      setReport(r);
      toast.success(
        `Validated ${r.total} row(s): ${r.valid} ok, ${r.invalid} with errors.`,
      );
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const commit = useMutation({
    mutationFn: () => studentsApi.import(file!, true),
    onSuccess: (r) => {
      setReport(r);
      toast.success(`Imported ${r.imported} student(s).`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rowBadge = (status: string) =>
    status === "IMPORTED" ? (
      <Badge>Imported</Badge>
    ) : status === "ERROR" ? (
      <Badge variant="destructive">Error</Badge>
    ) : (
      <Badge variant="secondary">Valid</Badge>
    );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Import students"
        description="Bulk-register from XLSX — validate first, then commit valid rows"
      >
        <Button variant="outline" onClick={() => router.push("/admin/students")}>
          Back to students
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>1. Prepare your file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Download the template, fill one student per row (Bangla names are
            supported), then upload it below. Each student needs one guardian —
            siblings sharing a guardian phone are automatically linked to the
            same record.
          </p>
          <Button
            variant="outline"
            disabled={downloadTemplate.isPending}
            onClick={() => downloadTemplate.mutate()}
          >
            Download XLSX template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload &amp; validate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
              setReport(null);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
            <span className="text-sm text-muted-foreground">
              {file ? file.name : "No file selected"}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!file || dryRun.isPending}
              onClick={() => dryRun.mutate()}
            >
              {dryRun.isPending ? "Validating…" : "Validate (dry run)"}
            </Button>
            <Button
              variant="secondary"
              disabled={
                !file ||
                commit.isPending ||
                !report ||
                report.committed ||
                report.valid === 0
              }
              onClick={() => commit.mutate()}
            >
              {commit.isPending
                ? "Importing…"
                : `Commit ${report?.valid ?? 0} valid row(s)`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>
              3. {report.committed ? "Import result" : "Validation report"}
            </CardTitle>
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant="outline">Total: {report.total}</Badge>
              <Badge variant="secondary">Valid: {report.valid}</Badge>
              <Badge variant="destructive">Errors: {report.invalid}</Badge>
              {report.committed ? (
                <Badge>Imported: {report.imported}</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">UID</th>
                    <th className="px-3 py-2 font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.rows.map((row) => (
                    <tr key={row.row}>
                      <td className="px-3 py-2">{row.row}</td>
                      <td className="px-3 py-2">{rowBadge(row.status)}</td>
                      <td className="px-3 py-2">{row.studentUid ?? "—"}</td>
                      <td className="px-3 py-2">
                        {row.errors.length > 0 ? (
                          <ul className="list-inside list-disc text-destructive">
                            {row.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        ) : null}
                        {row.warnings.length > 0 ? (
                          <ul className="list-inside list-disc text-amber-600">
                            {row.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : null}
                        {row.errors.length === 0 && row.warnings.length === 0
                          ? "—"
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
