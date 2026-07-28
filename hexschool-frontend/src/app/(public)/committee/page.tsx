import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Card, CardContent } from "@/components/ui/card";
import { Nothing, PageBanner, RichText, Section } from "../_components/ui";

/**
 * The managing committee, and — because a chairman's or principal's
 * message is stored on their committee row — the school's messages too.
 * Members carrying a message get a full-width block; the rest are cards.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Managing committee",
  description: "The governing body of the school and their messages.",
  alternates: { canonical: "/committee" },
};

export default async function CommitteePage() {
  const members = await publicSite.committee();
  const withMessage = (members ?? []).filter((member) => member.message);
  const rest = (members ?? []).filter((member) => !member.message);

  return (
    <>
      <PageBanner
        title="Managing committee"
        subtitle="Who governs the school."
        breadcrumb="Committee"
      />

      {withMessage.map((member) => (
        <Section key={member.id} className="max-w-4xl">
          <div className="flex flex-col gap-6 sm:flex-row">
            {member.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.photoUrl}
                alt=""
                className="h-40 w-40 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold">{member.designation}</h2>
              <p className="text-muted-foreground">{member.name}</p>
              <RichText html={member.message ?? ""} className="mt-4" />
            </div>
          </div>
        </Section>
      ))}

      <Section title={withMessage.length > 0 ? "Members" : undefined}>
        {rest.length === 0 && withMessage.length === 0 ? (
          <Nothing>The committee list is not published yet.</Nothing>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {rest.map((member) => (
              <Card key={member.id}>
                <CardContent className="p-5 text-center">
                  {member.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.photoUrl}
                      alt=""
                      className="mx-auto h-24 w-24 rounded-full object-cover"
                    />
                  ) : (
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-muted text-xl font-medium text-muted-foreground">
                      {member.name.slice(0, 1)}
                    </div>
                  )}
                  <h3 className="mt-3 font-medium">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {member.designation}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
