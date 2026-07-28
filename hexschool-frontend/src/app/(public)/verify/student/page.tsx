import type { Metadata } from "next";
import { PageBanner, Section } from "../../_components/ui";
import { StudentVerifyForm } from "./verify-form";

/**
 * Public student verification (roadmap §5). A stranger holding an ID card
 * can confirm it is genuine; the API decides which fields that entitles
 * them to see (`website.student_verification_fields`) and answers the
 * same 404 for a wrong ID as for a disabled feature.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Student verification",
  description: "Confirm that a student ID card issued by the school is genuine.",
  alternates: { canonical: "/verify/student" },
  robots: { index: true, follow: true },
};

export default function VerifyStudentPage() {
  return (
    <>
      <PageBanner
        title="Student verification"
        subtitle="Enter the student ID printed on the card, or scan its QR code."
        breadcrumb="Verification"
      />
      <Section className="max-w-xl">
        <StudentVerifyForm />
      </Section>
    </>
  );
}
