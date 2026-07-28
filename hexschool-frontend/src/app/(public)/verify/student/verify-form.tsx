"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  publicSiteApi,
  type StudentVerificationResult,
} from "@/lib/api/website";
import {
  verifyStudentSchema,
  type VerifyStudentForm,
} from "@/lib/validations/website";

export function StudentVerifyForm() {
  const [result, setResult] = useState<StudentVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<VerifyStudentForm>({
    resolver: zodResolver(verifyStudentSchema),
    defaultValues: { identifier: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await publicSiteApi.verifyStudent(values.identifier));
    } catch {
      // One message for "no such student", "withheld" and "feature off" —
      // a public endpoint must not confirm that a person exists.
      setError("No matching student record was found.");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Verify a student ID</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier">Student ID or QR code value</Label>
              <Input
                id="identifier"
                placeholder="e.g. DEMO-202600001"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.identifier.message}
                </p>
              ) : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Checking…" : "Verify"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <BadgeCheck className="size-5" />
              Verified
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-5">
            {result.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.photoUrl}
                alt=""
                className="h-28 w-24 rounded object-cover"
              />
            ) : null}
            <dl className="grid gap-2 text-sm">
              <Row label="Student ID" value={result.studentUid} />
              {result.name ? <Row label="Name" value={result.name} /> : null}
              {result.class ? (
                <Row
                  label="Class"
                  value={[result.class, result.section, result.session]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ) : null}
              {result.roll !== undefined ? (
                <Row label="Roll" value={String(result.roll)} />
              ) : null}
              {result.status ? (
                <Row label="Status" value={result.status} />
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
