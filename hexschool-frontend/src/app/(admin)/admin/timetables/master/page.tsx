"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi } from "@/lib/api/structure";
import { timetableApi } from "@/lib/api/timetable";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import { WEEKDAY_SHORT } from "@/lib/validations/timetable";

/** Load bands for the teacher heat view — periods per week. */
function loadTone(periods: number, busiest: number): string {
  if (busiest === 0) return "";
  const ratio = periods / busiest;
  if (ratio > 0.85) return "bg-destructive/15";
  if (ratio > 0.6) return "bg-amber-500/15";
  return "";
}

/**
 * Whole-school view: how complete each section's routine is, and a
 * read-only heat table of teacher load. This is where a scheduler spots
 * the person carrying twice everyone else's week.
 */
export default function MasterRoutinePage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const [shiftId, setShiftId] = useState("");
  const [classId, setClassId] = useState("");

  const shifts = useQuery({
    queryKey: ["shifts", "all"],
    queryFn: () => structureApi.shifts.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const master = useQuery({
    queryKey: ["master-routine", { sessionId, shiftId, classId }],
    queryFn: () =>
      timetableApi.master({
        sessionId,
        ...(shiftId ? { shiftId } : {}),
        ...(classId ? { classId } : {}),
      }),
    enabled: !!sessionId,
  });

  const busiest = Math.max(
    0,
    ...(master.data?.teacherLoad ?? []).map((row) => row.periodsPerWeek),
  );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Master routine"
        description={
          session
            ? `Coverage and teacher load across ${session.name}`
            : "Select a session from the header switcher"
        }
      >
        <Button variant="outline" asChild>
          <Link href="/admin/timetables">Routines</Link>
        </Button>
        <Can permission="timetable.export">
          <Button
            variant="outline"
            disabled={!sessionId}
            onClick={() =>
              void timetableApi
                .downloadMaster({ sessionId, shiftId, classId })
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Export PDF
          </Button>
        </Can>
      </PageHeader>

      {!sessionId ? (
        <EmptyState
          title="No session selected"
          description="Pick an academic session from the switcher in the header."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="w-52 space-y-1">
              <Label>Shift</Label>
              <Select
                value={shiftId || "ALL"}
                onValueChange={(v) => setShiftId(v === "ALL" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All shifts</SelectItem>
                  {(shifts.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-52 space-y-1">
              <Label>Class</Label>
              <Select
                value={classId || "ALL"}
                onValueChange={(v) => setClassId(v === "ALL" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All classes</SelectItem>
                  {(classes.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {master.isPending ? (
            <LoadingBlock />
          ) : master.isError ? (
            <ErrorState onRetry={() => void master.refetch()} />
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-lg font-medium">Section coverage</h2>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Section</TableHead>
                        <TableHead>Shift</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Filled</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Coverage</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {master.data.sections.map((row) => {
                        const percent =
                          row.capacity > 0
                            ? Math.round((row.filled / row.capacity) * 100)
                            : 0;
                        return (
                          <TableRow key={row.sectionId}>
                            <TableCell className="font-medium">
                              {row.sectionLabel}
                            </TableCell>
                            <TableCell>{row.shiftName ?? "—"}</TableCell>
                            <TableCell>
                              {row.status ? (
                                <Badge variant="default">{row.status}</Badge>
                              ) : (
                                <Badge variant="outline">Not built</Badge>
                              )}
                            </TableCell>
                            <TableCell>{row.filled}</TableCell>
                            <TableCell>{row.capacity}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-24 overflow-hidden rounded bg-muted">
                                  <div
                                    className={cn(
                                      "h-full",
                                      percent >= 80
                                        ? "bg-emerald-600"
                                        : percent >= 40
                                          ? "bg-amber-500"
                                          : "bg-destructive",
                                    )}
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                                <span className="text-xs tabular-nums">
                                  {percent}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {row.timetableId ? (
                                <Button size="sm" variant="ghost" asChild>
                                  <Link
                                    href={`/admin/timetables/${row.timetableId}`}
                                  >
                                    Open
                                  </Link>
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-medium">Teacher load</h2>
                {master.data.teacherLoad.length === 0 ? (
                  <EmptyState
                    title="No published routines yet"
                    description="Load appears once at least one section's routine is published."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Employee ID</TableHead>
                          <TableHead>Periods/week</TableHead>
                          {master.data.days.map((day) => (
                            <TableHead key={day}>
                              {WEEKDAY_SHORT[day]}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {master.data.teacherLoad.map((row) => (
                          <TableRow
                            key={row.teacherId}
                            className={loadTone(row.periodsPerWeek, busiest)}
                          >
                            <TableCell className="font-medium">
                              {row.name}
                            </TableCell>
                            <TableCell>{row.employeeId}</TableCell>
                            <TableCell className="tabular-nums">
                              {row.periodsPerWeek}
                            </TableCell>
                            {master.data.days.map((day) => (
                              <TableCell key={day} className="tabular-nums">
                                {row.byDay[day] ?? 0}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
