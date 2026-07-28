import type { Metadata } from "next";
import { PageBanner, Section } from "../_components/ui";
import { ResultSearch } from "./result-search";

/**
 * The website result search (roadmap M19 §5). The API has been live since
 * Module 15; this is the page it was waiting for.
 *
 * Rendered dynamically rather than ISR: a search is a per-visitor query,
 * and result day is exactly when a stale cached answer would be wrong.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Result search",
  description:
    "Look up a published exam result by class and roll number, or by student ID.",
  alternates: { canonical: "/results" },
};

export default function ResultsPage() {
  return (
    <>
      <PageBanner
        title="Result search"
        subtitle="Pick the exam and class, then enter the roll number."
        breadcrumb="Results"
      />
      <Section className="max-w-3xl">
        <ResultSearch />
      </Section>
    </>
  );
}
