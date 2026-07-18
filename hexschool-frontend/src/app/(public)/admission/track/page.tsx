"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  admissionPublicApi,
  APPLICATION_STATUS_LABELS,
  type TrackResult,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { trackSchema, type TrackValues } from "@/lib/validations/admission";

const STATUS_HINTS: Partial<Record<TrackResult["status"], string>> = {
  PAYMENT_PENDING:
    "Pay the application fee at the school office to confirm the application.",
  TEST_SCHEDULED: "Download the admit card and arrive 30 minutes early.",
  SELECTED:
    "Congratulations! Complete admission at the school office before the deadline.",
  WAITLISTED:
    "You are on the waiting list — you will be notified if a seat frees up.",
  ADMITTED: "Admission confirmed. Welcome!",
  EXPIRED: "The admission deadline passed. Contact the school office.",
};

export default function AdmissionTrackPage() {
  const [result, setResult] = useState<TrackResult | null>(null);

  const form = useForm<TrackValues>({
    resolver: zodResolver(trackSchema),
    defaultValues: { appNo: "", phone: "" },
  });

  const track = useMutation({
    mutationFn: (values: TrackValues) =>
      admissionPublicApi.track(values.appNo.trim(), values.phone),
    onSuccess: setResult,
    onError: (err) => {
      setResult(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const admitCard = useMutation({
    mutationFn: () =>
      admissionPublicApi.downloadAdmitCard(
        form.getValues("appNo").trim(),
        form.getValues("phone"),
      ),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Track Application
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the application number from your submission SMS together with
          the verified phone number.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <FormProvider {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((v) => track.mutate(v))}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="track-no">Application number</Label>
                  <Input
                    id="track-no"
                    placeholder="ADM-27-000123"
                    {...form.register("appNo")}
                  />
                  {form.formState.errors.appNo?.message ? (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.appNo.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="track-phone">Phone number</Label>
                  <Input
                    id="track-phone"
                    inputMode="numeric"
                    placeholder="01XXXXXXXXX"
                    {...form.register("phone")}
                  />
                  {form.formState.errors.phone?.message ? (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.phone.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <Button type="submit" disabled={track.isPending}>
                {track.isPending ? <Spinner /> : "Track"}
              </Button>
            </form>
          </FormProvider>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {result.applicationNo}
              <Badge
                variant={
                  ["REJECTED", "CANCELLED", "EXPIRED", "FAILED"].includes(
                    result.status,
                  )
                    ? "destructive"
                    : "default"
                }
              >
                {APPLICATION_STATUS_LABELS[result.status]}
              </Badge>
            </CardTitle>
            <CardDescription>
              {result.applicantName} · {result.className} · {result.cycleName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {STATUS_HINTS[result.status] ? (
              <p className="text-sm">{STATUS_HINTS[result.status]}</p>
            ) : null}

            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Payment</dt>
              <dd>
                {result.paymentStatus}
                {result.applicationFee > 0
                  ? ` (fee BDT ${result.applicationFee.toFixed(2)})`
                  : ""}
              </dd>
              {result.test ? (
                <>
                  <dt className="text-muted-foreground">Admission test</dt>
                  <dd>
                    {result.test.date}
                    {result.test.venue ? ` · ${result.test.venue}` : ""} ·
                    total {result.test.totalMarks}
                  </dd>
                </>
              ) : null}
              {result.testMarks !== null ? (
                <>
                  <dt className="text-muted-foreground">Test marks</dt>
                  <dd>{result.testMarks}</dd>
                </>
              ) : null}
              {result.meritPosition !== null ? (
                <>
                  <dt className="text-muted-foreground">Merit position</dt>
                  <dd>{result.meritPosition}</dd>
                </>
              ) : null}
              {result.admissionDeadline ? (
                <>
                  <dt className="text-muted-foreground">
                    Admission deadline
                  </dt>
                  <dd>{result.admissionDeadline.slice(0, 10)}</dd>
                </>
              ) : null}
              {result.studentUid ? (
                <>
                  <dt className="text-muted-foreground">Student ID</dt>
                  <dd className="font-medium">{result.studentUid}</dd>
                </>
              ) : null}
            </dl>

            {result.testRequired &&
            ["TEST_SCHEDULED", "PASSED", "FAILED", "SELECTED", "WAITLISTED", "ADMITTED"].includes(
              result.status,
            ) &&
            result.test ? (
              <Button
                variant="outline"
                disabled={admitCard.isPending}
                onClick={() => admitCard.mutate()}
              >
                {admitCard.isPending ? <Spinner /> : "Download admit card"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <Link href="/admission" className="underline">
          ← Back to admissions
        </Link>
      </p>
    </main>
  );
}
