"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VISITOR_PURPOSE_LABELS, visitorApi } from "@/lib/api/community";

/**
 * Roadmap §4's daily register.
 *
 * **The "signed out by" column is the honest one.** It says which
 * departures the school actually witnessed and which the day-end sweep
 * wrote at nine o'clock because nobody signed out — two different facts,
 * and a register that showed them identically would be useless for the
 * one question it would ever be pulled out for.
 */
export function VisitorRegisterTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const report = useQuery({
    queryKey: ["visitors", "register", params],
    queryFn: () => visitorApi.register(params),
  });

  if (report.isLoading) return <LoadingBlock />;
  if (report.isError || !report.data) {
    return <ErrorState onRetry={() => void report.refetch()} />;
  }

  const data = report.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="reg-from">From</Label>
          <Input
            id="reg-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-to">To</Label>
          <Input
            id="reg-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Can permission="visitor.export">
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void visitorApi.downloadRegister(params)}
            >
              XLSX
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void visitorApi.printRegister(params)}
            >
              Print (PDF)
            </Button>
          </div>
        </Can>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Visits" value={String(data.stats.total)} />
        <StatCard title="Still inside" value={String(data.stats.inside)} />
        <StatCard
          title="Average stay"
          value={`${data.stats.avgStayMinutes} min`}
        />
        <StatCard
          title="Closed by the sweep"
          value={String(data.stats.autoCheckedOut)}
          hint="Departures nobody witnessed"
        />
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          title="No visits in this window"
          description="Pick a wider date range, or check somebody in on the desk."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Purpose</th>
                <th className="p-3">To meet</th>
                <th className="p-3">Pass</th>
                <th className="p-3">In</th>
                <th className="p-3">Out</th>
                <th className="p-3">Minutes</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={`${row.phone}-${row.checkIn}-${i}`} className="border-t">
                  <td className="p-3 font-medium">{row.name}</td>
                  <td className="p-3 text-muted-foreground">{row.phone}</td>
                  <td className="p-3">
                    {VISITOR_PURPOSE_LABELS[row.purpose]}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {row.whomToMeet ?? "—"}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {row.gatePassNo ?? "—"}
                  </td>
                  <td className="p-3">
                    {new Date(row.checkIn).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {row.checkOut ? (
                      <span className="flex items-center gap-2">
                        {new Date(row.checkOut).toLocaleString()}
                        {row.autoCheckedOut && (
                          <Badge variant="outline">Day-end sweep</Badge>
                        )}
                      </span>
                    ) : (
                      <Badge>Still inside</Badge>
                    )}
                  </td>
                  <td className="p-3">{row.minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
