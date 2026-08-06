import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageBanner, Section } from "../../_components/ui";
import { CertificateVerifyForm } from "./verify-form";

/**
 * Certificate verification — **live since Module 27**, replacing the
 * placeholder M19 shipped so that printed certificates could already carry
 * this URL.
 *
 * Rendered dynamically: a verification is a per-visitor lookup, and a
 * cached answer about whether a document is genuine is exactly the answer
 * that must never be stale (the M19 result-search reasoning).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Certificate verification",
  description:
    "Verify a testimonial, transfer or character certificate issued by the school.",
  alternates: { canonical: "/verify/certificate" },
};

export default async function VerifyCertificatePage({
  searchParams,
}: {
  // Next 16: `searchParams` is a promise and synchronous access is gone.
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  return (
    <>
      <PageBanner
        title="Certificate verification"
        subtitle="Check that a certificate issued by the school is genuine."
        breadcrumb="Verification"
      />
      <Section className="max-w-xl space-y-6">
        <CertificateVerifyForm initialCode={code} />
        <div className="flex flex-wrap gap-3">
          <Button asChild size="sm" variant="outline">
            <Link href="/verify/student">Verify a student ID</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/contact">Contact the office</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
