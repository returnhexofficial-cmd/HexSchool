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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  CERTIFICATE_STATUS_LABELS,
  CERTIFICATE_STATUS_VARIANT,
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  ISSUE_KIND_LABELS,
  certificateApi,
  type Certificate,
  type CertificateStatus,
  type CertificateType,
} from "@/lib/api/documents";

/**
 * The issuance register (roadmap §5's "Certificate register table —
 * filters, reprint, revoke").
 *
 * **Nothing on this screen edits a certificate**, and that is the module's
 * whole posture: an issued certificate is a physical object in somebody
 * else's possession. The row's actions are print, duplicate, correct and
 * revoke — every one of which produces a *new* record rather than changing
 * one, so the register reads as a history and not as a current state.
 */
export function RegisterTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<CertificateType | "">("");
  const [status, setStatus] = useState<CertificateStatus | "">("");
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reissuing, setReissuing] = useState<{
    certificate: Certificate;
    kind: "DUPLICATE" | "CORRECTION";
  } | null>(null);
  const [reason, setReason] = useState("");

  const list = useQuery({
    queryKey: ["certificates", { search, type, status }],
    queryFn: () =>
      certificateApi.list({
        limit: 100,
        search: search || undefined,
        type: type || undefined,
        status: status || undefined,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["certificates"] });

  const revoke = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      certificateApi.revoke(input.id, { reason: input.reason }),
    onSuccess: (result) => {
      toast.success(`${result.certificate.certificateNo} revoked`);
      result.warnings.forEach((w) => toast.info(w));
      setRevoking(null);
      setReason("");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const reissue = useMutation({
    mutationFn: (input: {
      id: string;
      kind: "DUPLICATE" | "CORRECTION";
      remarks?: string;
    }) =>
      certificateApi.reissue(input.id, {
        kind: input.kind,
        remarks: input.remarks,
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.certificate.certificateNo} issued (${ISSUE_KIND_LABELS[result.certificate.issueKind]})`,
      );
      result.warnings.forEach((w) => toast.info(w));
      setReissuing(null);
      setReason("");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => certificateApi.remove(id),
    onSuccess: () => {
      toast.success("Draft deleted");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cert-search">Search</Label>
          <Input
            id="cert-search"
            className="w-64"
            placeholder="Number, code, name or student ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cert-type">Type</Label>
          <select
            id="cert-type"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as CertificateType | "")}
          >
            <option value="">All types</option>
            {CERTIFICATE_TYPES.map((value) => (
              <option key={value} value={value}>
                {CERTIFICATE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cert-status">Status</Label>
          <select
            id="cert-status"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as CertificateStatus | "")}
          >
            <option value="">All</option>
            {(["DRAFT", "ISSUED", "REVOKED"] as CertificateStatus[]).map((s) => (
              <option key={s} value={s}>
                {CERTIFICATE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isLoading && <LoadingBlock />}
      {list.isError && <ErrorState onRetry={() => void list.refetch()} />}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          title="Nothing in the register yet"
          description="Issue a certificate from the Issue tab, or enter a pre-system one."
        />
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Number</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Class</th>
                <th className="p-3 font-medium">Issued</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Verify code</th>
                <th className="p-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="p-3 font-mono text-xs">
                    {row.certificateNo ?? "—"}
                    {row.issueKind !== "ORIGINAL" && (
                      <Badge variant="outline" className="ml-2">
                        {ISSUE_KIND_LABELS[row.issueKind]}
                      </Badge>
                    )}
                    {row.isLegacy && (
                      <Badge variant="outline" className="ml-2">
                        Pre-system
                      </Badge>
                    )}
                    {row.original?.certificateNo && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        of {row.original.certificateNo}
                      </div>
                    )}
                  </td>
                  <td className="p-3">{CERTIFICATE_TYPE_LABELS[row.type]}</td>
                  <td className="p-3">
                    {row.student.firstName} {row.student.lastName}
                    <div className="text-xs text-muted-foreground">
                      {row.student.studentUid}
                    </div>
                  </td>
                  <td className="p-3">
                    {row.dataSnapshot?.class || row.enrollment?.class.name || "—"}
                    <div className="text-xs text-muted-foreground">
                      {row.dataSnapshot?.session || row.session?.name || ""}
                    </div>
                  </td>
                  <td className="p-3">
                    {row.issuedAt ? row.issuedAt.slice(0, 10) : "—"}
                  </td>
                  <td className="p-3">
                    <Badge variant={CERTIFICATE_STATUS_VARIANT[row.status]}>
                      {CERTIFICATE_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.clearanceOverrideBy && (
                      <div className="mt-1 text-xs text-amber-600">
                        Clearance waived
                      </div>
                    )}
                    {row.revokedReason && (
                      <div className="mt-1 max-w-56 text-xs text-muted-foreground">
                        {row.revokedReason}
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {row.verifyCode ?? "—"}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status !== "DRAFT" && row.bodyHtml !== null && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void certificateApi.print(row.id, row.certificateNo)
                          }
                        >
                          Print
                        </Button>
                      )}
                      <Can permission="certificate.issue">
                        {row.status === "ISSUED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setReissuing({
                                certificate: row,
                                kind: "DUPLICATE",
                              })
                            }
                          >
                            Duplicate
                          </Button>
                        )}
                        {row.status === "REVOKED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setReissuing({
                                certificate: row,
                                kind: "CORRECTION",
                              })
                            }
                          >
                            Reissue corrected
                          </Button>
                        )}
                        {row.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => remove.mutate(row.id)}
                          >
                            Delete draft
                          </Button>
                        )}
                      </Can>
                      <Can permission="certificate.revoke">
                        {row.status === "ISSUED" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setRevoking(row)}
                          >
                            Revoke
                          </Button>
                        )}
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── revoke ── */}
      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke {revoking?.certificateNo}
            </DialogTitle>
            <DialogDescription>
              The file and the register entry are kept. Anybody checking the
              code will be told the certificate was revoked, and shown this
              reason — so write it for them, not for the office.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="revoke-reason">Reason</Label>
            <Input
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Name corrected and reissued as TC-26-0031"
            />
            {reason.trim().length > 0 && reason.trim().length < 10 && (
              <p className="text-xs text-destructive">
                A sentence, not a word — this is published.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 10 || revoke.isPending}
              onClick={() =>
                revoking &&
                revoke.mutate({ id: revoking.id, reason: reason.trim() })
              }
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── duplicate / correction ── */}
      <Dialog
        open={reissuing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReissuing(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reissuing?.kind === "DUPLICATE"
                ? `Duplicate of ${reissuing?.certificate.certificateNo}`
                : `Correction of ${reissuing?.certificate.certificateNo}`}
            </DialogTitle>
            <DialogDescription>
              {reissuing?.kind === "DUPLICATE"
                ? "A duplicate carries its own number, prints with a watermark, and references the original. The original stays valid — the family may yet find it."
                : "A correction replaces a revoked certificate. Both stay in the register, linked, so the school can always say what happened."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reissue-remarks">Note (optional)</Label>
            <Input
              id="reissue-remarks"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Original lost by the family"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReissuing(null)}>
              Cancel
            </Button>
            <Button
              disabled={reissue.isPending}
              onClick={() =>
                reissuing &&
                reissue.mutate({
                  id: reissuing.certificate.id,
                  kind: reissuing.kind,
                  remarks: reason.trim() || undefined,
                })
              }
            >
              Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
