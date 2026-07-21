"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  attendanceReportApi,
  type ReportFormat,
} from "@/lib/api/attendance";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  ATTENDANCE_STATUS_CODES,
  dhakaMonth,
  dhakaToday,
} from "@/lib/validations/attendance";

type Tab = "summary" | "monthly" | "daily" | "late";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "monthly", label: "Monthly register" },
  { id: "daily", label: "Daily sheet" },
  { id: "late", label: "Late analysis" },
];

export default function AttendanceReportsPage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const [tab, setTab] = useState<Tab>("summary");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(dhakaMonth());
  const [date, setDate] = useState(dhakaToday());

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const sections = useQuery({
    queryKey: ["sections", { sessionId, classId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId, classId, limit: 100 }),
    enabled: !!sessionId && !!classId,
  });

  const download = async (
    report: "daily" | "monthly" | "summary" | "late-analysis",
    query: object,
    format: ReportFormat,
  ) => {
    try {
      await attendanceReportApi.download(report, query, format);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Attendance reports"
        description={
          session
            ? `Registers, percentages and exports for ${session.name}`
            : "Select a session from the header switcher"
        }
      />

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "default" : "ghost"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {tab !== "summary" ? (
          <>
            <div className="w-44 space-y-1">
              <Label>Class</Label>
              <Select
                value={classId || undefined}
                onValueChange={(v) => {
                  setClassId(v);
                  setSectionId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {(classes.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44 space-y-1">
              <Label>Section</Label>
              <Select
                value={sectionId || undefined}
                onValueChange={setSectionId}
                disabled={!classId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a section" />
                </SelectTrigger>
                <SelectContent>
                  {(sections.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
        {tab === "daily" ? (
          <div className="w-44 space-y-1">
            <Label htmlFor="report-date">Date</Label>
            <Input
              id="report-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        ) : tab !== "summary" ? (
          <div className="w-44 space-y-1">
            <Label htmlFor="report-month">Month</Label>
            <Input
              id="report-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      {!sessionId ? (
        <EmptyState
          title="No session selected"
          description="Pick an academic session from the switcher in the header."
        />
      ) : tab === "summary" ? (
        <SummaryTab
          sessionId={sessionId}
          onExport={(format) =>
            void download("summary", { sessionId }, format)
          }
        />
      ) : tab === "monthly" ? (
        sectionId ? (
          <MonthlyTab
            sectionId={sectionId}
            month={month}
            onExport={(format) =>
              void download("monthly", { sectionId, month }, format)
            }
          />
        ) : (
          <EmptyState title="Pick a section" description="The register is per section." />
        )
      ) : tab === "daily" ? (
        <DailyTab
          sessionId={sessionId}
          sectionId={sectionId || undefined}
          date={date}
          onExport={(format) =>
            void download(
              "daily",
              { date, sessionId, sectionId: sectionId || undefined },
              format,
            )
          }
        />
      ) : (
        <LateTab
          sessionId={sessionId}
          sectionId={sectionId || undefined}
          month={month}
          onExport={(format) =>
            void download(
              "late-analysis",
              { month, sessionId, sectionId: sectionId || undefined },
              format,
            )
          }
        />
      )}
    </main>
  );
}

function ExportButtons({
  onExport,
}: {
  onExport: (format: ReportFormat) => void;
}) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => onExport("xlsx")}>
        Export XLSX
      </Button>
      <Button size="sm" variant="outline" onClick={() => onExport("pdf")}>
        Export PDF
      </Button>
    </div>
  );
}

/** Dependency-free sparkline for the daily attendance trend. */
function TrendChart({ points }: { points: Array<{ date: string; percentage: number }> }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const step = 100 / (points.length - 1);
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${100 - p.percentage}`)
      .join(" ");
  }, [points]);

  if (points.length < 2) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-32 w-full rounded-md border bg-muted/30"
      role="img"
      aria-label="Daily attendance percentage trend"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
    </svg>
  );
}

function SummaryTab({
  sessionId,
  onExport,
}: {
  sessionId: string;
  onExport: (format: ReportFormat) => void;
}) {
  const report = useQuery({
    queryKey: ["attendance-summary", sessionId],
    queryFn: () => attendanceReportApi.summary({ sessionId }),
  });

  if (report.isPending)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  const data = report.data;
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ExportButtons onExport={onExport} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Overall attendance" value={`${data.overall.percentage}%`} />
        <StatCard title="Working days" value={String(data.workingDays)} />
        <StatCard title="Marked days" value={String(data.overall.markedDays)} />
        <StatCard title="Sections" value={String(data.sections.length)} />
      </div>

      <TrendChart points={data.trend.filter((p) => p.percentage > 0)} />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Enrolled</TableHead>
              <TableHead>Marked</TableHead>
              <TableHead>Present</TableHead>
              <TableHead>Absent</TableHead>
              <TableHead>Late</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.sections.map((row) => (
              <TableRow key={row.sectionId}>
                <TableCell>{row.className}</TableCell>
                <TableCell>{row.sectionName}</TableCell>
                <TableCell>{row.enrolled}</TableCell>
                <TableCell>{row.marked}</TableCell>
                <TableCell>{row.counts.PRESENT}</TableCell>
                <TableCell>{row.counts.ABSENT}</TableCell>
                <TableCell>{row.counts.LATE}</TableCell>
                <TableCell className="text-right font-medium">
                  {row.percentage}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MonthlyTab({
  sectionId,
  month,
  onExport,
}: {
  sectionId: string;
  month: string;
  onExport: (format: ReportFormat) => void;
}) {
  const report = useQuery({
    queryKey: ["attendance-monthly", sectionId, month],
    queryFn: () => attendanceReportApi.monthly({ sectionId, month }),
  });

  if (report.isPending)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  const data = report.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.section.className} — Section {data.section.name} ·{" "}
          {data.days.length} working day(s)
        </p>
        <ExportButtons onExport={onExport} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">Roll</TableHead>
              <TableHead className="sticky left-12 bg-background">Name</TableHead>
              {data.days.map((day) => (
                <TableHead key={day} className="px-1 text-center">
                  {day.slice(8)}
                </TableHead>
              ))}
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.enrollmentId}>
                <TableCell className="sticky left-0 bg-background font-medium">
                  {row.rollNo}
                </TableCell>
                <TableCell className="sticky left-12 whitespace-nowrap bg-background">
                  {row.name}
                </TableCell>
                {data.days.map((day) => (
                  <TableCell key={day} className="px-1 text-center">
                    {row.marks[day]
                      ? ATTENDANCE_STATUS_CODES[row.marks[day]]
                      : ""}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">
                  {row.summary.percentage}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        P present · A absent · L late · V leave · H half day · — holiday
      </p>
    </div>
  );
}

function DailyTab({
  sessionId,
  sectionId,
  date,
  onExport,
}: {
  sessionId: string;
  sectionId?: string;
  date: string;
  onExport: (format: ReportFormat) => void;
}) {
  const report = useQuery({
    queryKey: ["attendance-daily", sessionId, sectionId, date],
    queryFn: () => attendanceReportApi.daily({ date, sessionId, sectionId }),
  });

  if (report.isPending)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  const data = report.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {data.totals.marked} of {data.totals.enrolled} marked ·{" "}
            {data.totals.percentage}%
          </span>
          {data.holiday.holiday ? (
            <Badge variant="secondary">
              {data.holiday.title ?? "Holiday"}
            </Badge>
          ) : null}
        </div>
        <ExportButtons onExport={onExport} />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Enrolled</TableHead>
              <TableHead>Marked</TableHead>
              <TableHead>Present</TableHead>
              <TableHead>Absent</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.sections.map((row) => (
              <TableRow key={row.sectionId}>
                <TableCell>{row.className}</TableCell>
                <TableCell>{row.sectionName}</TableCell>
                <TableCell>{row.enrolled}</TableCell>
                <TableCell>{row.marked}</TableCell>
                <TableCell>{row.counts.PRESENT}</TableCell>
                <TableCell>{row.counts.ABSENT}</TableCell>
                <TableCell className="text-right font-medium">
                  {row.percentage}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data.students ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Roll</TableHead>
                <TableHead>UID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((row) => (
                <TableRow key={row.studentUid}>
                  <TableCell className="font-medium">{row.rollNo}</TableCell>
                  <TableCell>{row.studentUid}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.status ?? "UNMARKED"}</Badge>
                  </TableCell>
                  <TableCell>{row.remarks ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function LateTab({
  sessionId,
  sectionId,
  month,
  onExport,
}: {
  sessionId: string;
  sectionId?: string;
  month: string;
  onExport: (format: ReportFormat) => void;
}) {
  const report = useQuery({
    queryKey: ["attendance-late", sessionId, sectionId, month],
    queryFn: () =>
      attendanceReportApi.lateAnalysis({ month, sessionId, sectionId }),
  });

  if (report.isPending)
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  const data = report.data;
  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="No late arrivals"
        description={`Nobody was marked late in ${data.month}.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Flagged at {data.threshold} late day(s) per month.
        </p>
        <ExportButtons onExport={onExport} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>UID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Late days</TableHead>
              <TableHead>Dates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.studentUid}>
                <TableCell>{row.studentUid}</TableCell>
                <TableCell>
                  {row.name}
                  {row.flagged ? (
                    <Badge variant="destructive" className="ml-2">
                      flagged
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{row.sectionName}</TableCell>
                <TableCell className="font-medium">{row.lateDays}</TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                  {row.dates.join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
