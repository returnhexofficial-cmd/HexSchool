import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Card, CardContent } from "@/components/ui/card";
import { PageBanner, Section } from "../_components/ui";
import { ContactFormCard } from "./contact-form";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach the school office — address, phone, email and a map.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const config = await publicSite.config();
  const school = config?.school;

  return (
    <>
      <PageBanner
        title="Contact us"
        subtitle="The office replies during working hours."
        breadcrumb="Contact"
      />
      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="font-semibold">{school?.name}</h2>
                {school?.address ? (
                  <p className="text-sm text-muted-foreground">
                    {school.address}
                  </p>
                ) : null}
                {school?.phone ? (
                  <p className="text-sm">
                    <a
                      href={`tel:${school.phone}`}
                      className="text-primary underline"
                    >
                      {school.phone}
                    </a>
                  </p>
                ) : null}
                {school?.email ? (
                  <p className="text-sm">
                    <a
                      href={`mailto:${school.email}`}
                      className="text-primary underline"
                    >
                      {school.email}
                    </a>
                  </p>
                ) : null}
                {school?.eiin ? (
                  <p className="text-sm text-muted-foreground">
                    EIIN {school.eiin}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {config?.site.mapEmbedUrl ? (
              <div className="overflow-hidden rounded-lg border">
                <iframe
                  src={config.site.mapEmbedUrl}
                  title="School location"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-72 w-full border-0"
                />
              </div>
            ) : null}
          </div>

          <ContactFormCard />
        </div>
      </Section>
    </>
  );
}
