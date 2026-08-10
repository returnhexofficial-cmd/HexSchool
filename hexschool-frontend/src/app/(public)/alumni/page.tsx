import type { Metadata } from "next";
import { PageBanner, Section } from "../_components/ui";
import { AlumniDirectory } from "./alumni-directory";
import { AlumniRegisterCard } from "./register-form";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Alumni",
  description:
    "Former students of the school — search the directory by batch, or register your own profile.",
  alternates: { canonical: "/alumni" },
};

export default function AlumniPage() {
  return (
    <>
      <PageBanner
        title="Alumni"
        subtitle="Find people you were at school with, and put yourself on the map."
        breadcrumb="Alumni"
      />
      <Section>
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <AlumniDirectory />
          <AlumniRegisterCard />
        </div>
      </Section>
    </>
  );
}
