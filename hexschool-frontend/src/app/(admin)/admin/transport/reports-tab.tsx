"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  CAPACITY_VARIANT,
  formatBdt,
  routeApi,
  transportReportApi,
} from "@/lib/api/transport";

type ReportKey = "utilization" | "collection" | "roster";

const REPORTS: Array<[ReportKey, string]> = [
  ["utilization", "Capacity utilization"],
  ["collection", "Fee collection"],
  ["roster", "Route roster"],
];

export function TransportReportsTab() {
  const [report, setReport] = useState<ReportKey>("utilization");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {REPORTS.map(([key, label]) => (
          <Button
            key={key}
            variant={report === key ? "secondary" : "ghost"}
            size="sm"
            className={cn(report === key && "font-medium")}
            onClick={() => setReport(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {report === "utilization" && <UtilizationReport />}
      {report === "collection" && <CollectionReport />}
      {report === "roster" && <RosterReport />}
    </div>
  );
}

function UtilizationReport() {
  const query = useQuery({
    queryKey: ["transport-utilization"],
    queryFn: transportReportApi.utilization,
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const report = query.data!;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Routes" value={String(report.fleet.routes)} />
        <StatCard title="Seats" value={String(report.fleet.seats)} />
        <StatCard title="Riders" value={String(report.fleet.riders)} />
        <StatCard
          title="Utilization"
          value={
            report.fleet.utilization === null
              ? "—"
              : `${report.fleet.utilization}%`
          }
          hint={
            report.fleet.routes > report.fleet.measurable
              ? `${report.fleet.routes - report.fleet.measurable} route(s) have no vehicle and are excluded`
              : undefined
          }
        />
      </div>

      <div className="flex justify-end">
        <Can permission="transport.export">
          <Button
            variant="outline"
            onClick={() =>
              transportReportApi
                .downloadUtilization()
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Download XLSX
          </Button>
        </Can>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Seats</TableHead>
              <TableHead className="text-right">Riders</TableHead>
              <TableHead className="text-right">Utilization</TableHead>
              <TableHead className="text-right">Expected monthly</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.routes.map((row) => (
              <TableRow key={row.routeId}>
                <TableCell className="font-medium">{row.routeName}</TableCell>
                <TableCell className="text-sm">
                  {row.vehicleRegNo ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.capacity ?? "—"}
                </TableCell>
                <TableCell className="text-right">{row.riders}</TableCell>
                <TableCell className="text-right">
                  {row.utilization === null ? "—" : `${row.utilization}%`}
                </TableCell>
                <TableCell className="text-right">
                  ৳{formatBdt(row.expectedMonthly)}
                </TableCell>
                <TableCell>
                  <Badge variant={CAPACITY_VARIANT[row.state]}>{row.state}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CollectionReport() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const query = useQuery({
    queryKey: ["transport-collection", month],
    queryFn: () => transportReportApi.collection(month),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const report = query.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-48 space-y-1">
          <Label htmlFor="collection-month">Month</Label>
          <Input
            id="collection-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <Can permission="transport.export">
          <Button
            variant="outline"
            onClick={() =>
              transportReportApi
                .downloadCollection(month)
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Download XLSX
          </Button>
        </Can>
      </div>

      <p className="text-sm text-muted-foreground">{report.note}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Riders" value={String(report.totals.riders)} />
        <StatCard title="Expected" value={`৳${formatBdt(report.totals.expected)}`} />
        <StatCard title="Invoiced" value={`৳${formatBdt(report.totals.invoiced)}`} />
        <StatCard
          title="Collected"
          value={`৳${formatBdt(report.totals.collected)}`}
          hint={`৳${formatBdt(report.totals.outstanding)} outstanding`}
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead className="text-right">Riders</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead className="text-right">Collected</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.routes.map((row) => (
              <TableRow key={row.routeId}>
                <TableCell className="font-medium">{row.routeName}</TableCell>
                <TableCell className="text-right">{row.riders}</TableCell>
                <TableCell className="text-right">
                  ৳{formatBdt(row.expected)}
                </TableCell>
                <TableCell className="text-right">
                  ৳{formatBdt(row.invoiced)}
                </TableCell>
                <TableCell className="text-right">
                  ৳{formatBdt(row.collected)}
                </TableCell>
                <TableCell className="text-right">
                  ৳{formatBdt(row.outstanding)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RosterReport() {
  const [routeId, setRouteId] = useState("");

  const routes = useQuery({
    queryKey: ["transport-routes"],
    queryFn: () => routeApi.list(),
  });

  const roster = useQuery({
    queryKey: ["transport-roster", routeId],
    queryFn: () => transportReportApi.roster(routeId),
    enabled: Boolean(routeId),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64 space-y-1">
          <Label htmlFor="roster-route">Route</Label>
          <select
            id="roster-route"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
          >
            <option value="">— pick a route —</option>
            {(routes.data ?? []).map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </select>
        </div>
        {routeId && (
          <Can permission="transport.export">
            <div className="space-x-2">
              <Button
                variant="outline"
                onClick={() =>
                  transportReportApi
                    .downloadRoster(routeId)
                    .catch((err) => toast.error(apiErrorMessage(err)))
                }
              >
                XLSX
              </Button>
              <Button
                onClick={() =>
                  transportReportApi
                    .printRoster(routeId)
                    .catch((err) => toast.error(apiErrorMessage(err)))
                }
              >
                Driver’s sheet (PDF)
              </Button>
            </div>
          </Can>
        )}
      </div>

      {!routeId ? (
        <EmptyState
          title="Pick a route"
          description="The roster is what the driver carries: riders per stop, with the guardian's phone beside each name."
        />
      ) : roster.isLoading ? (
        <LoadingBlock />
      ) : roster.isError ? (
        <ErrorState onRetry={() => void roster.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {roster.data!.route.vehicleRegNo ?? "No vehicle"} ·{" "}
            {roster.data!.route.driverName ?? "no driver"}{" "}
            {roster.data!.route.driverPhone ?? ""} ·{" "}
            {roster.data!.riders.length} rider(s)
          </p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stop</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Guardian</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.data!.riders.map((rider) => (
                  <TableRow key={rider.assignmentId}>
                    <TableCell className="text-sm">{rider.stopName}</TableCell>
                    <TableCell className="text-sm">
                      {rider.pickupTime ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {rider.studentName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {rider.className}
                      {rider.sectionName ? ` ${rider.sectionName}` : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {rider.guardianName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {rider.guardianPhone ?? "not on file"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
