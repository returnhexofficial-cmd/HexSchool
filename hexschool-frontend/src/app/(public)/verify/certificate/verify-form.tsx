"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, ShieldAlert, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicSiteApi } from "@/lib/api/website";
import {
  verifyCodeSchema,
  type VerifyCodeFormValues,
} from "@/lib/validations/document";

/**
 * Certificate verification (roadmap M27 §5), replacing the placeholder
 * M19 shipped.
 *
 * **The QR on a printed certificate lands here with `?code=` already
 * filled**, so the lookup runs on arrival — the person scanning is an
 * admissions clerk with a phone, and asking them to retype what they just
 * scanned is the friction that makes people ring the office instead.
 *
 * That auto-lookup is the **query's initial key**, not an effect: the code
 * being checked is state, the answer is server state, and TanStack Query
 * already owns the second (a `useEffect` calling `setState` is what React
 * 19's compiler correctly refuses).
 *
 * REVOKED is shown as its own outcome rather than folded into "not found":
 * a cancelled certificate and a forgery must not look identical to whoever
 * is checking, and the school's own reason is the useful half of the
 * answer.
 */
export function CertificateVerifyForm({
  initialCode,
}: {
  initialCode?: string;
}) {
  const [code, setCode] = useState(initialCode ?? "");

  const form = useForm<VerifyCodeFormValues>({
    resolver: zodResolver(verifyCodeSchema),
    defaultValues: { code: initialCode ?? "" },
  });

  const query = useQuery({
    queryKey: ["verify-certificate", code],
    queryFn: () => publicSiteApi.verifyCertificate(code),
    enabled: code.trim().length > 0,
    // A verification is never stale-servable: whether a document is
    // genuine is exactly the answer that must not come from a cache.
    staleTime: 0,
    retry: false,
  });

  const onSubmit = form.handleSubmit((values) => setCode(values.code.trim()));
  const result = query.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Verify a certificate</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                placeholder="e.g. 4KJ7M2QX9B"
                autoComplete="off"
                className="font-mono uppercase"
                {...form.register("code")}
              />
              {form.formState.errors.code ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.code.message}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The ten-character code printed at the foot of the
                  certificate, or scan its QR. Dashes and capitals do not
                  matter.
                </p>
              )}
            </div>
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? "Checking…" : "Verify"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {query.isError && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm">
            The verification service could not be reached. Please try again,
            or contact the school office.
          </CardContent>
        </Card>
      )}

      {result?.outcome === "VALID" && result.certificate && (
        <Card className="border-emerald-500">
          <CardHeader className="flex flex-row items-center gap-2">
            <BadgeCheck className="size-5 text-emerald-600" />
            <CardTitle className="text-emerald-700 dark:text-emerald-400">
              Genuine certificate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{result.message}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Certificate number"
                value={result.certificate.certificateNo}
              />
              <Field label="Type" value={titleCase(result.certificate.type)} />
              <Field label="Issued to" value={result.certificate.studentName} />
              <Field label="Issued on" value={result.certificate.issueDate} />
              {result.certificate.className && (
                <Field label="Class" value={result.certificate.className} />
              )}
              {result.certificate.session && (
                <Field label="Session" value={result.certificate.session} />
              )}
              {result.certificate.originalNo && (
                <Field
                  label="Duplicate of"
                  value={result.certificate.originalNo}
                />
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {result?.outcome === "REVOKED" && result.certificate && (
        <Card className="border-amber-500">
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldAlert className="size-5 text-amber-600" />
            <CardTitle className="text-amber-700 dark:text-amber-400">
              Issued, then revoked
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{result.message}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Certificate number"
                value={result.certificate.certificateNo}
              />
              <Field label="Issued to" value={result.certificate.studentName} />
              <Field label="Issued on" value={result.certificate.issueDate} />
              {result.certificate.revokedAt && (
                <Field
                  label="Revoked on"
                  value={result.certificate.revokedAt}
                />
              )}
            </dl>
            <p className="text-muted-foreground">
              This document should not be relied on. Please contact the school
              office.
            </p>
          </CardContent>
        </Card>
      )}

      {result?.outcome === "NOT_FOUND" && (
        <Card className="border-destructive">
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldX className="size-5 text-destructive" />
            <CardTitle className="text-destructive">
              No matching certificate
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{result.message}</CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
