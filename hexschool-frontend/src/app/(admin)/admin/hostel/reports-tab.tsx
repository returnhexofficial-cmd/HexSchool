"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDate } from "@/lib/utils/date";
import {
  formatBdt,
  hostelApi,
  hostelReportApi,
} from "@/lib/api/hostel";

const REPORTS = [
  ["occupancy", "Occupancy"],
  ["residents", "Resident register"],
  ["dues", "Fee dues"],
  ["mealoffs", "Meal-off summary"],
] as const;

type ReportKey = (typeof REPORTS)[number][0];

/**
 * The four reports roadmap §4 asks for.
 *
 * Each one reads the **same** shape the export writes and the same
 * `summarize` arithmetic the occupancy grid draws, so a warden reading
 * "31 of 40" on a screen and a head reading it in a spreadsheet are
 * reading one number. The dues figures come from
 * `LedgerService.outstandingFor` — the single dues source the vacate gate
 * also reads, so the office never sees two answers.
 */
export function HostelReportsTab() {
  const [report, setReport] = useState<ReportKey>("occupancy");
  const [hostelId, setHostelId] = useState("");

  const hostels = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rep-kind">Report</Label>
          <select
            id="rep-kind"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={report}
            onChange={(e) => setReport(e.target.value as ReportKey)}
          >
            {REPORTS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="rep-hostel">Hostel</Label>
          <select
            id="rep-hostel"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
          >
            <option value="">All hostels</option>
            {(hostels.data ?? []).map((summary) => (
              <option key={summary.hostel.id} value={summary.hostel.id}>
                {summary.hostel.name}
              </option>
            ))}
          </select>
        </div>

        <Can permission="hostel.export">
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void download(report, hostelId).catch((error) =>
                  toast.error(apiErrorMessage(error)),
                )
              }
            >
              Download XLSX
            </Button>
            {report === "residents" && (
              <Button
                variant="outline"
                onClick={() =>
                  void hostelReportApi
                    .printResidents(hostelId || undefined)
                    .catch((error) => toast.error(apiErrorMessage(error)))
                }
              >
                Print register
              </Button>
            )}
          </div>
        </Can>
      </div>

      {report === "occupancy" && <OccupancyReport hostelId={hostelId} />}
      {report === "residents" && <ResidentsReport hostelId={hostelId} />}
      {report === "dues" && <DuesReport hostelId={hostelId} />}
      {report === "mealoffs" && <MealOffReport hostelId={hostelId} />}
    </div>
  );
}

function download(report: ReportKey, hostelId: string): Promise<void> {
  const id = hostelId || undefined;
  switch (report) {
    case "occupancy":
      return hostelReportApi.downloadOccupancy(id);
    case "residents":
      return hostelReportApi.downloadResidents(id);
    case "dues":
      return hostelReportApi.downloadDues(id);
    default:
      return hostelReportApi.downloadMealOffs(id);
  }
}

function OccupancyReport({ hostelId }: { hostelId: string }) {
  const query = useQuery({
    queryKey: ["hostel-report", "occupancy", hostelId],
    queryFn: () =>
      hostelReportApi.occupancy({ hostelId: hostelId || undefined }),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const report = query.data;
  if (!report || report.hostels.length === 0) {
    return <EmptyState title="No hostels to report on" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {report.overall.occupied} of{" "}
        {report.overall.total - report.overall.maintenance} usable beds taken
        across the school
        {report.overall.maintenance > 0
          ? ` · ${report.overall.maintenance} out of service`
          : ""}
        . Beds out of service are left out of the percentage — a bed nobody
        can sleep in is not a vacancy the school failed to fill.
      </p>

      {report.hostels.map((hostel) => (
        <div key={hostel.hostelId} className="rounded-md border">
          <div className="flex items-center justify-between border-b p-3">
            <div>
              <span className="font-medium">{hostel.hostelName}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {hostel.occupancy.occupied}/{hostel.occupancy.total} beds
              </span>
            </div>
            <Badge>{Math.round(hostel.occupancy.utilization)}%</Badge>
          </div>
          <div className="divide-y">
            {hostel.floors.map((floor) => (
              <div key={floor.floor} className="p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {floor.floor === 0 ? "Ground floor" : `Floor ${floor.floor}`}{" "}
                  · {floor.occupancy.occupied}/{floor.occupancy.total}
                </p>
                <div className="flex flex-wrap gap-2">
                  {floor.rooms.map((room) => (
                    <div
                      key={room.roomId}
                      className="rounded border px-2 py-1 text-xs"
                      title={`৳${formatBdt(room.monthlyFee)}/month`}
                    >
                      <span className="font-medium">{room.roomNo}</span>{" "}
                      <span
                        className={cn(
                          "text-muted-foreground",
                          room.status === "MAINTENANCE" && "text-amber-600",
                        )}
                      >
                        {room.occupancy.occupied}/{room.occupancy.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResidentsReport({ hostelId }: { hostelId: string }) {
  const query = useQuery({
    queryKey: ["hostel-report", "residents", hostelId],
    queryFn: () =>
      hostelReportApi.residents({ hostelId: hostelId || undefined }),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0) return <EmptyState title="Nobody is living in yet" />;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="p-3 font-medium">Hostel</th>
            <th className="p-3 font-medium">Room / bed</th>
            <th className="p-3 font-medium">Student</th>
            <th className="p-3 font-medium">Class</th>
            <th className="p-3 font-medium">Since</th>
            <th className="p-3 font-medium">Mess</th>
            <th className="p-3 font-medium">Guardian</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.allocationId} className="border-t">
              <td className="p-3">{row.hostelName}</td>
              <td className="p-3">
                {row.roomNo} · {row.bedNo}
              </td>
              <td className="p-3">
                <div>{row.studentName}</div>
                <div className="text-xs text-muted-foreground">
                  {row.studentUid}
                </div>
              </td>
              <td className="p-3">
                {row.className}
                {row.sectionName ? ` ${row.sectionName}` : ""}
              </td>
              <td className="p-3">{formatDate(row.startDate)}</td>
              <td className="p-3">{row.messPlan ?? "—"}</td>
              <td className="p-3">
                {row.guardianName ?? "—"}
                {row.guardianPhone && (
                  <div className="text-xs text-muted-foreground">
                    {row.guardianPhone}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuesReport({ hostelId }: { hostelId: string }) {
  const query = useQuery({
    queryKey: ["hostel-report", "dues", hostelId],
    queryFn: () => hostelReportApi.dues({ hostelId: hostelId || undefined }),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No boarder owes anything"
        description="Only residents with an outstanding balance are listed."
      />
    );
  }

  const total = rows.reduce((sum, row) => sum + row.outstanding, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">৳{formatBdt(total)}</span> outstanding
        across {rows.length} boarder(s). Read from the fee ledger — the same
        figure that decides whether a bed can be released.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Student</th>
              <th className="p-3 font-medium">Hostel / room</th>
              <th className="p-3 font-medium">Class</th>
              <th className="p-3 font-medium">Guardian</th>
              <th className="p-3 font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.allocationId} className="border-t">
                <td className="p-3">
                  <div>{row.studentName}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.studentUid}
                  </div>
                </td>
                <td className="p-3">
                  {row.hostelName} · {row.roomNo}
                </td>
                <td className="p-3">{row.className}</td>
                <td className="p-3">
                  {row.guardianName ?? "—"}
                  {row.guardianPhone && (
                    <div className="text-xs text-muted-foreground">
                      {row.guardianPhone}
                    </div>
                  )}
                </td>
                <td className="p-3 font-medium">
                  ৳{formatBdt(row.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MealOffReport({ hostelId }: { hostelId: string }) {
  const query = useQuery({
    queryKey: ["hostel-report", "mealoffs", hostelId],
    queryFn: () =>
      hostelReportApi.mealOffs({ hostelId: hostelId || undefined }),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0) return <EmptyState title="No meal-offs on record" />;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="p-3 font-medium">Student</th>
            <th className="p-3 font-medium">Hostel</th>
            <th className="p-3 font-medium">Requests</th>
            <th className="p-3 font-medium">Approved</th>
            <th className="p-3 font-medium">Refused</th>
            <th className="p-3 font-medium">Days claimed</th>
            <th className="p-3 font-medium">Days credited</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.studentUid} className="border-t">
              <td className="p-3">
                <div>{row.studentName}</div>
                <div className="text-xs text-muted-foreground">
                  {row.studentUid}
                </div>
              </td>
              <td className="p-3">{row.hostelName}</td>
              <td className="p-3">{row.requested}</td>
              <td className="p-3">{row.approved}</td>
              <td className="p-3">{row.rejected}</td>
              <td className="p-3">{row.daysRequested}</td>
              <td className="p-3 font-medium">{row.daysApproved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
