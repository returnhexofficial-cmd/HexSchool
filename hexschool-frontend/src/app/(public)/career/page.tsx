import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Nothing, PageBanner, Section } from "../_components/ui";
import { CareerOpenings } from "./career-openings";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Career",
  description: "Job openings at the school and how to apply.",
  alternates: { canonical: "/career" },
};

export default async function CareerPage() {
  const openings = await publicSite.careers();

  return (
    <>
      <PageBanner
        title="Career"
        subtitle="Join the school."
        breadcrumb="Career"
      />
      <Section>
        {!openings || openings.length === 0 ? (
          <Nothing>There are no open positions right now.</Nothing>
        ) : (
          <CareerOpenings openings={openings} />
        )}
      </Section>
    </>
  );
}
