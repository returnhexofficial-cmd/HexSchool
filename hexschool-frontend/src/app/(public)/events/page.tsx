import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Badge } from "@/components/ui/badge";
import { formatDate, Nothing, PageBanner, Section } from "../_components/ui";

/**
 * The public slice of the academic calendar — only events an admin marked
 * `is_public` (the flag Module 05 added for this page). Internal events
 * and holidays never appear here.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Events",
  description: "Upcoming public events on the school calendar.",
  alternates: { canonical: "/events" },
};

export default async function EventsPage() {
  const events = await publicSite.events();

  return (
    <>
      <PageBanner
        title="Events"
        subtitle="Public events on the academic calendar."
        breadcrumb="Events"
      />
      <Section>
        {!events || events.length === 0 ? (
          <Nothing>No upcoming public events.</Nothing>
        ) : (
          <ul className="divide-y rounded-lg border">
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 p-5 sm:flex-row">
                <div className="w-full shrink-0 sm:w-48">
                  <p className="font-medium">{formatDate(event.startDate)}</p>
                  {event.endDate !== event.startDate ? (
                    <p className="text-sm text-muted-foreground">
                      until {formatDate(event.endDate)}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{event.title}</h2>
                    <Badge variant="outline">{event.type}</Badge>
                  </div>
                  {event.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
