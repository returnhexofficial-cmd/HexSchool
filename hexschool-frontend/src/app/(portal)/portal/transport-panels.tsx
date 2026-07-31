"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import {
  ASSIGNMENT_STATUS_LABELS,
  formatBdt,
  type PortalTransport,
} from "@/lib/api/transport";

export interface TransportFetchers {
  /** Query-key discriminator: `self` or `child-<id>`. */
  key: string;
  get: () => Promise<PortalTransport>;
}

/**
 * The portal's transport panel (roadmap M25 §5's "parent portal shows
 * child's route/stop/times").
 *
 * The student and the parent see **exactly the same thing** — unlike the
 * assignments and library panels, there is nothing here a rider can do,
 * so there is no `canAct` prop to get wrong. What the panel shows is a
 * deliberately thin projection: the stop, the two times, and the numbers
 * to ring when a bus has not come. No other rider's name, no seat count,
 * no licence dates.
 *
 * A child who does not ride gets the reason in plain words rather than an
 * empty card — the M09/M19 self-describing-stub shape.
 */
export function TransportPanels({ fetchers }: { fetchers: TransportFetchers }) {
  const query = useQuery({
    queryKey: ["portal-transport", fetchers.key],
    queryFn: fetchers.get,
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const data = query.data!;

  if (!data.assigned) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">School transport</h2>
        <p className="text-sm text-muted-foreground">
          {data.reason ?? "No bus route is assigned."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">School transport</h2>
        {data.status && (
          <Badge variant={data.status === "ACTIVE" ? "default" : "secondary"}>
            {ASSIGNMENT_STATUS_LABELS[data.status]}
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Route</p>
          <p className="font-medium">{data.route?.name}</p>
          <p className="text-sm text-muted-foreground">
            {data.route?.vehicleRegNo ?? "Vehicle to be confirmed"}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Stop</p>
          <p className="font-medium">{data.stop?.name}</p>
          <p className="text-sm text-muted-foreground">
            Pickup {data.stop?.pickupTime ?? "—"} · drop{" "}
            {data.stop?.dropTime ?? "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">
            Driver / helper
          </p>
          <p className="text-sm">
            {data.route?.substituteDriverName
              ? `${data.route.substituteDriverName} (standing in)`
              : (data.route?.driverName ?? "—")}
            {data.route?.driverPhone ? ` · ${data.route.driverPhone}` : ""}
          </p>
          {data.route?.helperName && (
            <p className="text-sm text-muted-foreground">
              Helper: {data.route.helperName}{" "}
              {data.route.helperPhone ? `· ${data.route.helperPhone}` : ""}
            </p>
          )}
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Monthly fare</p>
          <p className="font-medium">৳{formatBdt(data.stop?.monthlyFee ?? 0)}</p>
          <p className="text-sm text-muted-foreground">
            Billed with the monthly fees, from {data.startDate ?? "—"}
          </p>
        </div>
      </div>

      {data.remarks && (
        <p className="text-sm text-muted-foreground">Note: {data.remarks}</p>
      )}
    </section>
  );
}
