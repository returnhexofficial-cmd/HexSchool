"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBDT, portalApi } from "@/lib/api/portal";

/**
 * Where a gateway returns the payer (Module 16 §5 / Module 18 §5).
 *
 * The page **reports**, it never decides: the outcome comes from our own
 * payment rows, which only the M16 server-to-server `verify()` may move to
 * SUCCESS. So a payer who edits the redirect URL learns nothing, and a
 * payer who closed the bKash app mid-flow sees PENDING — honest, because
 * the hourly reconciliation sweep is what will settle it.
 *
 * PENDING is polled for a short while, since the IPN usually lands within
 * seconds of the redirect.
 */
export default function PortalPaymentPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <PaymentResult />
    </Suspense>
  );
}

const TONE = {
  SUCCESS: { label: "Payment received", variant: "secondary" as const },
  PARTIAL: { label: "Partly received", variant: "outline" as const },
  PENDING: { label: "Still confirming", variant: "outline" as const },
  FAILED: { label: "Payment failed", variant: "destructive" as const },
};

function PaymentResult() {
  const reference = useSearchParams().get("reference") ?? "";

  const q = useQuery({
    queryKey: ["portal", "payment", reference],
    queryFn: () => portalApi.paymentStatus(reference),
    enabled: reference.length > 0,
    // Keep asking while the gateway's IPN is in flight, then stop.
    refetchInterval: (query) =>
      query.state.data?.outcome === "PENDING" ? 3000 : false,
  });

  if (!reference) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <EmptyState
          title="Nothing to show"
          description="This page opens after a payment. No reference was supplied."
        />
        <Button asChild size="sm" className="mt-4">
          <Link href="/portal">Back to my portal</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <PageHeader title="Payment" description={`Reference ${reference}`} />

      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="space-y-2 rounded-md border p-4">
            <Badge variant={TONE[q.data!.outcome].variant}>
              {TONE[q.data!.outcome].label}
            </Badge>
            {q.data!.outcome === "SUCCESS" || q.data!.outcome === "PARTIAL" ? (
              <p className="text-2xl font-semibold">{formatBDT(q.data!.total)}</p>
            ) : null}
            {q.data!.outcome === "PENDING" && (
              <p className="text-sm text-muted-foreground">
                The gateway has not confirmed yet. You can safely close this
                page — the school reconciles unconfirmed payments
                automatically, and nothing is charged twice.
              </p>
            )}
            {q.data!.outcome === "FAILED" && (
              <p className="text-sm text-muted-foreground">
                No money was taken. You can try again from the Dues tab.
              </p>
            )}
          </div>

          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Invoice</th>
                  <th className="p-2">Method</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-2">{p.invoiceNo}</td>
                    <td className="p-2">{p.method}</td>
                    <td className="p-2">{p.status}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatBDT(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Button asChild size="sm" variant="outline">
        <Link href="/portal">Back to my portal</Link>
      </Button>
    </div>
  );
}
