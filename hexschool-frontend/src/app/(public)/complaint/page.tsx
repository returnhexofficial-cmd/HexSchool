import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { PageBanner, Section } from "../_components/ui";
import { ComplaintFormCard } from "./complaint-form";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Complaints & suggestions",
  description:
    "Tell the school about a problem, suggest an improvement, or leave feedback — with your name or anonymously.",
  alternates: { canonical: "/complaint" },
};

export default function ComplaintPage() {
  return (
    <>
      <PageBanner
        title="Complaints & suggestions"
        subtitle="Every submission gets a reference number and reaches the office."
        breadcrumb="Complaints"
      />
      <Section>
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <ComplaintFormCard />

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="font-semibold">What happens next</h2>
                <p className="text-muted-foreground">
                  Your submission is given a reference number and lands in
                  the school office. Somebody is assigned to it, and you are
                  told when it moves and what was done.
                </p>
                <p className="text-muted-foreground">
                  If it is still open after a few days, it is escalated
                  automatically to the head&apos;s desk.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="font-semibold">Submitting anonymously</h2>
                <p className="text-muted-foreground">
                  If you tick <strong>submit anonymously</strong>, the school
                  stores <strong>no name, no contact and no record of where
                  the submission came from</strong>. That is a genuine
                  promise and not a setting somebody can change afterwards.
                </p>
                <p className="text-muted-foreground">
                  It has one consequence: there is no way to reply to you.
                  Keep your reference number if you want to follow it up in
                  person.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
