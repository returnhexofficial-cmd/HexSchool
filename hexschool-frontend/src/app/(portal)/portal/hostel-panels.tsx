"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import {
  ALLOCATION_STATUS_LABELS,
  ALLOCATION_STATUS_VARIANT,
  MEAL_OFF_STATUS_LABELS,
  MEAL_OFF_VARIANT,
  formatBdt,
  type PortalHostelView,
} from "@/lib/api/hostel";

export interface HostelFetchers {
  /** Query-key discriminator: `self` or `child-<id>`. */
  key: string;
  get: () => Promise<PortalHostelView>;
}

/**
 * The portal's hostel panel (roadmap M26 §5's "parent portal shows
 * allocation details").
 *
 * The student and the parent see **exactly the same thing** — as with the
 * transport panel there is nothing here a boarder can *do*, so there is
 * no `canAct` prop to get wrong. What the panel shows is a deliberately
 * thin projection: the building, the room, the bed, what it costs, and
 * the child&rsquo;s own meal-off requests. No other boarder&rsquo;s name, no
 * occupancy figure for the building, no warden&rsquo;s personal number.
 *
 * The meal-offs are here because the commonest question a boarder&rsquo;s
 * parent has is whether the leave they asked for was approved — and
 * making them ring the office to find out is exactly what a portal exists
 * to stop.
 */
export function HostelPanels({ fetchers }: { fetchers: HostelFetchers }) {
  const query = useQuery({
    queryKey: ["portal-hostel", fetchers.key],
    queryFn: fetchers.get,
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const data = query.data!;

  if (!data.resident) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Hostel</h2>
        <p className="text-sm text-muted-foreground">
          {data.reason ?? "This student is not living in the school hostel."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Hostel</h2>
        {data.status && (
          <Badge variant={ALLOCATION_STATUS_VARIANT[data.status]}>
            {ALLOCATION_STATUS_LABELS[data.status]}
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Building</p>
          <p className="font-medium">{data.hostel?.name}</p>
          <p className="text-sm text-muted-foreground">
            {data.hostel?.wardenName
              ? `Warden: ${data.hostel.wardenName}`
              : "Warden not recorded"}
            {data.hostel?.phone ? ` · ${data.hostel.phone}` : ""}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">
            Room &amp; bed
          </p>
          <p className="font-medium">
            Room {data.room?.roomNo} · bed {data.room?.bedNo}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.room?.floor === 0
              ? "Ground floor"
              : `Floor ${data.room?.floor}`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">
            Monthly seat rent
          </p>
          <p className="font-medium">
            ৳{formatBdt(data.room?.monthlyFee ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground">
            Billed with the monthly fees, from {data.startDate ?? "—"}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Mess</p>
          {data.mess ? (
            <>
              <p className="font-medium">{data.mess.planName}</p>
              <p className="text-sm text-muted-foreground">
                ৳{formatBdt(data.mess.monthlyCharge)} a month, since{" "}
                {data.mess.startDate}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not on a mess plan.
            </p>
          )}
        </div>
      </div>

      {typeof data.securityDeposit === "number" &&
        data.securityDeposit > 0 && (
          <p className="text-sm text-muted-foreground">
            Security deposit held: ৳{formatBdt(data.securityDeposit)} — returned
            when the room is given up, less anything the school is keeping.
          </p>
        )}

      {data.mealOffs && data.mealOffs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-muted-foreground">
            Meal-off requests
          </p>
          <ul className="space-y-1.5">
            {data.mealOffs.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span>
                  {row.fromDate} → {row.toDate}{" "}
                  <span className="text-muted-foreground">
                    ({row.days} day{row.days === 1 ? "" : "s"})
                  </span>
                  {row.decisionNote && (
                    <span className="block text-xs text-muted-foreground">
                      {row.decisionNote}
                    </span>
                  )}
                </span>
                <Badge variant={MEAL_OFF_VARIANT[row.status]}>
                  {MEAL_OFF_STATUS_LABELS[row.status]}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            An approved meal-off is credited on the invoice after the days
            away, not the one you are looking at now.
          </p>
        </div>
      )}
    </section>
  );
}
