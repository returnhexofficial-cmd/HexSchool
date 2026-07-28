import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBanner, Section } from "../../_components/ui";

/**
 * Certificate verification. The page exists now and says plainly that the
 * capability is not live yet, rather than 404-ing — the school's printed
 * certificates can already carry this URL, and Module 27 fills in the
 * lookup behind it (the API endpoint already answers
 * `{ available: false, reason }`).
 */
export const metadata: Metadata = {
  title: "Certificate verification",
  description:
    "Verify a testimonial, transfer or character certificate issued by the school.",
  alternates: { canonical: "/verify/certificate" },
};

export default function VerifyCertificatePage() {
  return (
    <>
      <PageBanner
        title="Certificate verification"
        subtitle="Check that a certificate issued by the school is genuine."
        breadcrumb="Verification"
      />
      <Section className="max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Not available yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Online certificate verification is being rolled out with the
              school&rsquo;s document and certificate system. Until then,
              please contact the office to confirm a certificate.
            </p>
            <p>
              A student ID card can already be verified online.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild size="sm">
                <Link href="/verify/student">Verify a student ID</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/contact">Contact the office</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}
