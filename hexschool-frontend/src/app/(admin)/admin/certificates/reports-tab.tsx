"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { examApi } from "@/lib/api/exam";
import { formatDate } from "@/lib/utils/date";
import {
  CERTIFICATE_TYPE_LABELS,
  certificateApi,
  certificateReportApi,
  templateApi,
} from "@/lib/api/documents";

/**
 * The register report (the bound book an inspector asks for), the per-type
 * summary, and the bulk-prize wizard.
 *
 * **The prize wizard always previews first**, and the confirm button sends
 * both `dryRun:false` and `issue:true` — one flag would make an accidental
 * default into two hundred certificates, each a permanent register row with
 * a number that can never be reused.
 */
export function CertificateReportsTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [examId, setExamId] = useState("");
  const [topN, setTopN] = useState(3);
  const [templateId, setTemplateId] = useState("");

  const register = useQuery({
    queryKey: ["certificates", "register", { from, to }],
    queryFn: () =>
      certificateReportApi.register({
        from: from || undefined,
        to: to || undefined,
      }),
  });

  const summary = useQuery({
    queryKey: ["certificates", "summary", { from, to }],
    queryFn: () =>
      certificateReportApi.summary({
        from: from || undefined,
        to: to || undefined,
      }),
  });

  const exams = useQuery({
    queryKey: ["exams", "prize-picker"],
    queryFn: () => examApi.list({ limit: 50 }),
  });

  const prizeTemplates = useQuery({
    queryKey: ["certificate-templates", "PRIZE"],
    queryFn: () => templateApi.list({ type: "PRIZE", isActive: true }),
  });

  const prize = useMutation({
    mutationFn: (write: boolean) =>
      certificateApi.bulkPrize({
        examId,
        topN,
        templateId: templateId || undefined,
        dryRun: !write,
        issue: write,
      }),
    onSuccess: (result) => {
      result.warnings.forEach((w) => toast.info(w));
      result.failed.forEach((f) =>
        toast.error(`${f.studentName}: ${f.reason}`),
      );
      if (!result.dryRun) {
        toast.success(`${result.issued.length} prize certificate(s) issued`);
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const preview = prize.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rep-from">From</Label>
          <Input
            id="rep-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rep-to">To</Label>
          <Input
            id="rep-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Can permission="certificate.export">
          <Button
            variant="outline"
            onClick={() =>
              void certificateReportApi.downloadRegister({
                from: from || undefined,
                to: to || undefined,
              })
            }
          >
            Register (XLSX)
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void certificateReportApi.printRegister({
                from: from || undefined,
                to: to || undefined,
              })
            }
          >
            Register (PDF)
          </Button>
        </Can>
      </div>

      {/* ── summary ── */}
      <Card>
        <CardHeader>
          <CardTitle>By type</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.isLoading && <LoadingBlock />}
          {summary.isError && (
            <ErrorState onRetry={() => void summary.refetch()} />
          )}
          {summary.data && summary.data.byType.length === 0 && (
            <EmptyState
              title="Nothing issued in this window"
              description="Widen the dates, or issue a certificate first."
            />
          )}
          {summary.data && summary.data.byType.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Standing</th>
                  <th className="pb-2 font-medium">Revoked</th>
                  <th className="pb-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.byType.map((row) => (
                  <tr key={row.type} className="border-t">
                    <td className="py-2">
                      {CERTIFICATE_TYPE_LABELS[row.type]}
                    </td>
                    <td className="py-2">{row.issued}</td>
                    <td className="py-2">{row.revoked}</td>
                    <td className="py-2 font-medium">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── register preview ── */}
      <Card>
        <CardHeader>
          <CardTitle>
            Register
            {register.data && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {register.data.rows.length} entr
                {register.data.rows.length === 1 ? "y" : "ies"} ·{" "}
                {register.data.totals.revoked} revoked ·{" "}
                {register.data.totals.duplicates} duplicate(s)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {register.isLoading && <LoadingBlock />}
          {register.isError && (
            <ErrorState onRetry={() => void register.refetch()} />
          )}
          {(register.data?.rows ?? []).slice(0, 30).map((row) => (
            <div
              key={row.certificateNo}
              className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-0"
            >
              <span className="font-mono text-xs">{row.certificateNo}</span>
              <span>{CERTIFICATE_TYPE_LABELS[row.type]}</span>
              <span className="text-muted-foreground">{row.studentName}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(row.issueDate)}
              </span>
              {row.status === "REVOKED" && (
                <Badge variant="destructive">Revoked</Badge>
              )}
              {row.clearanceWaived && (
                <Badge variant="outline">Clearance waived</Badge>
              )}
              {row.isLegacy && <Badge variant="outline">Pre-system</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── bulk prize wizard ── */}
      <Can permission="certificate.issue">
        <Card>
          <CardHeader>
            <CardTitle>Prize certificates from an exam</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="prize-exam">Exam</Label>
                <select
                  id="prize-exam"
                  className="h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={examId}
                  onChange={(e) => setExamId(e.target.value)}
                >
                  <option value="">Pick an exam</option>
                  {(exams.data?.data ?? []).map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="prize-top">Top</Label>
                <Input
                  id="prize-top"
                  type="number"
                  min={1}
                  max={20}
                  className="w-20"
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="prize-template">Layout</Label>
                <select
                  id="prize-template"
                  className="h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Plain wording</option>
                  {(prizeTemplates.data ?? []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="outline"
                disabled={!examId || prize.isPending}
                onClick={() => prize.mutate(false)}
              >
                Preview
              </Button>
              <Button
                disabled={
                  !examId ||
                  !preview ||
                  preview.selection.total === 0 ||
                  prize.isPending
                }
                onClick={() => prize.mutate(true)}
              >
                Issue {preview?.selection.total ?? 0}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              The cut is on <strong>position</strong>, not on count — a shared
              second place takes both students, because handing one of two
              tied children a prize is not something a system should decide.
            </p>

            {preview && (
              <div className="space-y-3">
                {preview.selection.classes.map((entry) => (
                  <div key={entry.classId} className="rounded-md border p-3">
                    <div className="font-medium">{entry.className}</div>
                    {entry.note && (
                      <p className="text-xs text-amber-600">{entry.note}</p>
                    )}
                    <ul className="mt-1 text-sm">
                      {entry.winners.map((winner) => (
                        <li key={winner.enrollmentId}>
                          {winner.position}. {winner.studentName}
                          {winner.gpa !== null && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              GPA {winner.gpa.toFixed(2)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {preview.selection.skipped.map((skipped) => (
                  <p
                    key={skipped.classId}
                    className="text-xs text-muted-foreground"
                  >
                    {skipped.className}: {skipped.reason}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Can>
    </div>
  );
}
