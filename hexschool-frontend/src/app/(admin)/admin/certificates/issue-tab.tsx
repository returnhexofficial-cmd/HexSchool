"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { apiErrorMessage } from "@/lib/api/auth";
import { studentsApi } from "@/lib/api/students";
import { examApi } from "@/lib/api/exam";
import {
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  certificateApi,
  templateApi,
  type CertificateType,
  type Clearance,
} from "@/lib/api/documents";

type Step = "student" | "review" | "done";

/**
 * The issue wizard (roadmap §5): student search → data review → clearance
 * panel → confirm → download.
 *
 * **The clearance panel loads before the confirm button is enabled, and the
 * button reads the SERVER's verdict** rather than a client-side sum — the
 * M24 issue-desk rule. A transfer certificate over unpaid fees needs a
 * typed reason, and the field only appears once the server has said the
 * clearance is not met, so the reason recorded always corresponds to a real
 * refusal.
 *
 * **The TRANSFERRED consequence is a checkbox, not a surprise.** Issuing a
 * TC marks the student TRANSFERRED and deactivates their portal account;
 * the office says so before it happens rather than discovering it after.
 */
export function IssueTab() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("student");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [type, setType] = useState<CertificateType>("TRANSFER");
  const [templateId, setTemplateId] = useState("");
  const [examId, setExamId] = useState("");
  const [conduct, setConduct] = useState("");
  const [remarks, setRemarks] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [issued, setIssued] = useState<{
    id: string;
    certificateNo: string | null;
    verifyCode: string | null;
  } | null>(null);

  const students = useQuery({
    queryKey: ["students", "cert-search", debounced],
    queryFn: () => studentsApi.list({ search: debounced, limit: 15 }),
    enabled: debounced.trim().length >= 2,
  });

  const templates = useQuery({
    queryKey: ["certificate-templates", type],
    queryFn: () => templateApi.list({ type, isActive: true }),
  });

  const exams = useQuery({
    queryKey: ["exams", "cert-picker"],
    queryFn: () => examApi.list({ limit: 50 }),
    enabled: step === "review",
  });

  const clearance = useQuery({
    queryKey: ["certificates", "clearance", studentId, type],
    queryFn: () => certificateApi.clearance(studentId, type),
    enabled: step === "review" && studentId.length > 0,
  });

  const issue = useMutation({
    mutationFn: () =>
      certificateApi.create({
        studentId,
        type,
        templateId: templateId || undefined,
        examId: examId || undefined,
        conduct: conduct.trim() || undefined,
        remarks: remarks.trim() || undefined,
        issue: true,
        confirmTransfer: type === "TRANSFER" ? confirmTransfer : false,
        clearanceOverrideReason: overrideReason.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`${result.certificate.certificateNo} issued`);
      result.warnings.forEach((w) => toast.info(w));
      setIssued({
        id: result.certificate.id,
        certificateNo: result.certificate.certificateNo,
        verifyCode: result.certificate.verifyCode,
      });
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const verdict: Clearance | undefined = clearance.data;
  const needsReason =
    verdict !== undefined && !verdict.cleared && verdict.required;

  const reset = () => {
    setStep("student");
    setStudentId("");
    setStudentName("");
    setTemplateId("");
    setExamId("");
    setConduct("");
    setRemarks("");
    setOverrideReason("");
    setConfirmTransfer(false);
    setIssued(null);
  };

  return (
    <Can
      permission="certificate.issue"
      fallback={
        <p className="text-sm text-muted-foreground">
          You can read the register, but issuing a certificate needs
          <code className="mx-1">certificate.issue</code>.
        </p>
      }
    >
      <div className="space-y-4">
        {/* ── step 1: who ── */}
        {step === "student" && (
          <Card>
            <CardHeader>
              <CardTitle>Who is this certificate for?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="issue-search">Student</Label>
                  <Input
                    id="issue-search"
                    className="w-72"
                    placeholder="Name or student ID"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="issue-type">Certificate</Label>
                  <select
                    id="issue-type"
                    className="h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={type}
                    onChange={(e) => setType(e.target.value as CertificateType)}
                  >
                    {CERTIFICATE_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {CERTIFICATE_TYPE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {students.isLoading && <LoadingBlock />}
              {students.isError && (
                <ErrorState onRetry={() => void students.refetch()} />
              )}

              {(students.data?.data ?? []).length > 0 && (
                <div className="divide-y rounded-md border">
                  {(students.data?.data ?? []).map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-muted/50"
                      onClick={() => {
                        setStudentId(student.id);
                        setStudentName(
                          `${student.firstName} ${student.lastName}`,
                        );
                        setStep("review");
                      }}
                    >
                      <span>
                        {student.firstName} {student.lastName}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {student.studentUid}
                        </span>
                      </span>
                      <Badge variant="outline">{student.status}</Badge>
                    </button>
                  ))}
                </div>
              )}

              {debounced.trim().length < 2 && (
                <p className="text-sm text-muted-foreground">
                  Type at least two characters of a name or student ID.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── step 2: review + clearance ── */}
        {step === "review" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {CERTIFICATE_TYPE_LABELS[type]} for {studentName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="issue-template">Layout</Label>
                  <select
                    id="issue-template"
                    className="h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    <option value="">No layout (plain wording)</option>
                    {(templates.data ?? []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  {(templates.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No active {CERTIFICATE_TYPE_LABELS[type].toLowerCase()}{" "}
                      layout — the certificate will print a plain wording.
                    </p>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="issue-exam">Result to quote</Label>
                  <select
                    id="issue-exam"
                    className="h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={examId}
                    onChange={(e) => setExamId(e.target.value)}
                  >
                    <option value="">Latest published result</option>
                    {(exams.data?.data ?? []).map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    A withheld or unpublished result is never quoted.
                  </p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="issue-conduct">Conduct</Label>
                  <Input
                    id="issue-conduct"
                    value={conduct}
                    onChange={(e) => setConduct(e.target.value)}
                    placeholder="Leave blank for the school default"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="issue-remarks">Internal note</Label>
                  <Input
                    id="issue-remarks"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>

                {type === "TRANSFER" && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={confirmTransfer}
                      onChange={(e) => setConfirmTransfer(e.target.checked)}
                    />
                    <span>
                      Also mark {studentName} as <strong>TRANSFERRED</strong>.
                      This deactivates their portal account and takes them off
                      every roster. Leave it unticked to issue the certificate
                      without changing their status.
                    </span>
                  </label>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Clearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {clearance.isLoading && <LoadingBlock />}
                {clearance.isError && (
                  <ErrorState onRetry={() => void clearance.refetch()} />
                )}

                {verdict && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={verdict.cleared ? "default" : "destructive"}
                      >
                        {verdict.cleared ? "Clear" : "Not clear"}
                      </Badge>
                      {!verdict.required && (
                        <Badge variant="outline">Not gated for this type</Badge>
                      )}
                      {!verdict.complete && (
                        <Badge variant="secondary">Incomplete check</Badge>
                      )}
                      {verdict.totalOutstanding > 0 && (
                        <span className="text-sm">
                          {verdict.totalOutstanding.toFixed(2)} BDT outstanding
                        </span>
                      )}
                    </div>

                    {verdict.blockers.length > 0 && (
                      <ul className="space-y-2 text-sm">
                        {verdict.blockers.map((blocker) => (
                          <li
                            key={blocker.source}
                            className="rounded-md border p-2"
                          >
                            <div className="font-medium">{blocker.source}</div>
                            {blocker.amount > 0 && (
                              <div>{blocker.amount.toFixed(2)} BDT owed</div>
                            )}
                            {blocker.items > 0 && (
                              <div>{blocker.items} item(s) still held</div>
                            )}
                            {blocker.details.map((detail) => (
                              <div
                                key={detail}
                                className="text-xs text-muted-foreground"
                              >
                                {detail}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}

                    {verdict.warnings.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                        {verdict.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}

                    {needsReason && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="issue-override">
                          Reason for issuing anyway
                        </Label>
                        <Input
                          id="issue-override"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="Family settled at the office in cash; receipt 4471"
                        />
                        <p className="text-xs text-muted-foreground">
                          Needs <code>certificate.clearance.override</code>, and
                          is recorded against your name.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2 lg:col-span-2">
              <Button variant="ghost" onClick={reset}>
                Back
              </Button>
              <Button
                disabled={
                  issue.isPending ||
                  clearance.isLoading ||
                  (needsReason && overrideReason.trim().length < 10)
                }
                onClick={() => issue.mutate()}
              >
                Issue certificate
              </Button>
            </div>
          </div>
        )}

        {/* ── step 3: done ── */}
        {step === "done" && issued && (
          <Card>
            <CardHeader>
              <CardTitle>{issued.certificateNo} issued</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">
                Verification code{" "}
                <code className="font-mono">{issued.verifyCode}</code> — anybody
                can check this certificate with it, and the QR on the printed
                page carries the same code.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    void certificateApi.print(issued.id, issued.certificateNo)
                  }
                >
                  Print
                </Button>
                <Button variant="outline" onClick={reset}>
                  Issue another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Can>
  );
}
