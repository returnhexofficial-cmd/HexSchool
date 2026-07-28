"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AttendanceHistory,
  formatBDT,
  PerformanceHistory,
  PortalRoutine,
  StudentDocuments,
  StudentLedger,
  StudentOverview,
  StudentProfile,
} from "@/lib/api/portal";

export interface StudentFetchers {
  key: string;
  overview: () => Promise<StudentOverview>;
  attendance: () => Promise<AttendanceHistory>;
  results: () => Promise<PerformanceHistory>;
  dues: () => Promise<StudentLedger>;
  routine: () => Promise<PortalRoutine>;
  profile: () => Promise<StudentProfile>;
  documents: () => Promise<StudentDocuments>;
  /** Streams the report-card PDF for one published exam. */
  reportCard: (examId: string) => Promise<void>;
  /** Opens a gateway checkout for the selected invoices. */
  pay: (invoiceIds: string[], gateway: string) => Promise<{ checkoutUrl: string }>;
}

const TABS = [
  ["overview", "Overview"],
  ["routine", "Routine"],
  ["attendance", "Attendance"],
  ["results", "Results"],
  ["dues", "Dues"],
  ["documents", "Documents"],
  ["profile", "Profile"],
] as const;
type TabKey = (typeof TABS)[number][0];

export function StudentPanels({ fetchers }: { fetchers: StudentFetchers }) {
  const [tab, setTab] = useState<TabKey>("overview");
  return (
    <div className="space-y-5">
      {/* Horizontally scrollable on a phone — parents are mobile-first, and
          seven tabs do not fit a 360 px viewport. */}
      <div
        role="tablist"
        aria-label="Portal sections"
        className="-mx-1 flex gap-1 overflow-x-auto border-b px-1"
      >
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px shrink-0 rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "overview" ? (
        <OverviewPanel fetchers={fetchers} />
      ) : tab === "routine" ? (
        <RoutinePanel fetchers={fetchers} />
      ) : tab === "attendance" ? (
        <AttendancePanel fetchers={fetchers} />
      ) : tab === "results" ? (
        <ResultsPanel fetchers={fetchers} />
      ) : tab === "dues" ? (
        <DuesPanel fetchers={fetchers} />
      ) : tab === "documents" ? (
        <DocumentsPanel fetchers={fetchers} />
      ) : (
        <ProfilePanel fetchers={fetchers} />
      )}
    </div>
  );
}

function OverviewPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "overview"],
    queryFn: fetchers.overview,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Attendance"
          value={d.attendance.percentage != null ? `${d.attendance.percentage}%` : "—"}
          hint={`${d.attendance.present} present · ${d.attendance.absent} absent`}
        />
        <StatCard
          title="Average GPA"
          value={d.averageGpa ? d.averageGpa.toFixed(2) : "—"}
          hint={d.result ? `Last: ${d.result.grade}` : "No results yet"}
        />
        <StatCard title="Outstanding dues" value={formatBDT(d.dues.outstanding)} />
        <StatCard
          title="Class"
          value={d.enrollment ? `${d.enrollment.className}` : "—"}
          hint={
            d.enrollment
              ? `${d.enrollment.sectionName} · Roll ${d.enrollment.rollNo}`
              : "Not enrolled"
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Today’s classes</h3>
          {d.todayPeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes scheduled today.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.todayPeriods.map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.subject}</span>
                    <span className="text-muted-foreground"> · {p.teacher}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {p.time}
                    {p.roomNo ? ` · ${p.roomNo}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Notices</h3>
          {d.notices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing new.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.notices.map((n) => (
                <li key={n.id}>
                  <span className="font-medium">{n.title}</span>
                  {n.pinned && <Badge variant="secondary" className="ml-2">Pinned</Badge>}
                  <p className="line-clamp-2 text-muted-foreground">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  PRESENT: "bg-green-500",
  LATE: "bg-amber-500",
  HALF_DAY: "bg-orange-400",
  ABSENT: "bg-red-500",
  LEAVE: "bg-blue-400",
  HOLIDAY: "bg-muted",
};

function AttendancePanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "attendance"],
    queryFn: fetchers.attendance,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Attendance %" value={`${d.percentage}%`} />
        <StatCard title="Marked days" value={String(d.markedDays)} />
        <StatCard title="Present" value={String(d.counts.PRESENT ?? 0)} />
      </div>
      <div className="rounded-md border p-4">
        <h3 className="mb-3 text-sm font-medium">Recent days</h3>
        <div className="flex flex-wrap gap-1">
          {d.items.slice(-60).map((it, i) => (
            <span
              key={i}
              title={`${it.date}: ${it.status}`}
              className={cn(
                "size-4 rounded-sm",
                STATUS_TONE[it.status] ?? "bg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"] as const;

/**
 * The weekly routine (roadmap M18 §5). Only a PUBLISHED timetable reaches
 * a portal — the backend never returns a draft — so an empty grid here
 * means the school has not published one yet, and says so.
 */
function RoutinePanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "routine"],
    queryFn: fetchers.routine,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;

  if (!d.available || !d.slots || !d.cells) {
    return (
      <EmptyState
        title="No routine yet"
        description={d.reason ?? "The school has not published a routine."}
      />
    );
  }

  const slots = d.slots;
  const cells = d.cells;
  const daysWithClasses = DAYS.filter((day) =>
    cells.some((c) => c.day === day),
  );

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="p-2">Day</th>
            {slots.map((s) => (
              <th key={s.id} className="p-2">
                <div>{s.name}</div>
                <div className="text-xs font-normal">
                  {s.startTime}–{s.endTime}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {daysWithClasses.map((day) => (
            <tr key={day} className="border-b last:border-0">
              <td className="p-2 font-medium">{day}</td>
              {slots.map((s) => {
                const cell = cells.find(
                  (c) => c.day === day && c.periodSlotId === s.id,
                );
                return (
                  <td key={s.id} className="p-2 align-top">
                    {cell ? (
                      <>
                        <div className="font-medium">{cell.subject.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {cell.teacher.name}
                          {cell.roomNo ? ` · ${cell.roomNo}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "results"],
    queryFn: fetchers.results,
  });
  const [downloading, setDownloading] = useState<string | null>(null);

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const published = d.items.filter((r) => r.publishedAt);
  if (published.length === 0) {
    return <EmptyState title="No published results" description="Results appear here once published." />;
  }

  async function downloadCard(examId: string) {
    setDownloading(examId);
    try {
      await fetchers.reportCard(examId);
    } catch {
      toast.error("Could not download the report card");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-3">
      <StatCard title="Average GPA" value={d.averageGpa.toFixed(2)} hint={`${d.examsPublished} exam(s)`} />
      {published.map((r) => (
        <div
          key={r.examId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        >
          <div>
            <p className="font-medium">{r.examName}</p>
            <p className="text-xs text-muted-foreground">
              {r.className} · Roll {r.rollNo}
              {r.meritPositionClass ? ` · Merit ${r.meritPositionClass}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-semibold">GPA {r.gpa.toFixed(2)}</p>
              <Badge variant={r.status === "PASSED" ? "secondary" : "outline"}>
                {r.grade}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading === r.examId}
              onClick={() => void downloadCard(r.examId)}
            >
              {downloading === r.examId ? "Preparing…" : "Report card"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Gateways the M16 adapters implement (Rocket has none yet). */
const GATEWAYS = ["SSLCOMMERZ", "BKASH", "NAGAD"] as const;

function DuesPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "dues"],
    queryFn: fetchers.dues,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [gateway, setGateway] = useState<string>(GATEWAYS[0]);

  const pay = useMutation({
    mutationFn: () => fetchers.pay(selected, gateway),
    onSuccess: (res) => {
      // Leave the SPA for the gateway. The M16 callback concludes the
      // payment server-side, so navigating away cannot lose it.
      window.location.href = res.checkoutUrl;
    },
    onError: () => toast.error("Could not start the payment"),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const payable = d.payableInvoices ?? [];
  const selectedTotal = payable
    .filter((i) => selected.includes(i.id))
    .reduce((sum, i) => sum + i.outstanding, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Billed" value={formatBDT(d.totalBilled)} />
        <StatCard title="Paid" value={formatBDT(d.totalPaid)} />
        <StatCard title="Outstanding" value={formatBDT(d.outstanding)} />
      </div>

      {payable.length > 0 && (
        <div className="space-y-3 rounded-md border p-4">
          <h3 className="text-sm font-medium">Pay now</h3>
          <ul className="space-y-2">
            {payable.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 text-sm">
                <Checkbox
                  id={`inv-${inv.id}`}
                  checked={selected.includes(inv.id)}
                  onCheckedChange={(checked) =>
                    setSelected((prev) =>
                      checked
                        ? [...prev, inv.id]
                        : prev.filter((id) => id !== inv.id),
                    )
                  }
                />
                <Label htmlFor={`inv-${inv.id}`} className="flex-1 font-normal">
                  {inv.invoiceNo}
                  <span className="text-muted-foreground">
                    {" "}
                    · due {String(inv.dueDate).slice(0, 10)}
                  </span>
                </Label>
                <span className="tabular-nums">{formatBDT(inv.outstanding)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={gateway} onValueChange={setGateway}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GATEWAYS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={selected.length === 0 || pay.isPending}
              onClick={() => pay.mutate()}
            >
              {pay.isPending
                ? "Opening gateway…"
                : `Pay ${formatBDT(selectedTotal)}`}
            </Button>
          </div>
        </div>
      )}

      {d.entries.length === 0 ? (
        <EmptyState title="No fee history" description="Invoices and payments appear here." />
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Description</th>
                <th className="p-2 text-right">Debit</th>
                <th className="p-2 text-right">Credit</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="whitespace-nowrap p-2 text-xs">{e.date}</td>
                  <td className="p-2">{e.description}</td>
                  <td className="p-2 text-right">{e.debit ? formatBDT(e.debit) : "—"}</td>
                  <td className="p-2 text-right">{e.credit ? formatBDT(e.credit) : "—"}</td>
                  <td className="p-2 text-right font-medium">{formatBDT(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocumentsPanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "documents"],
    queryFn: fetchers.documents,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;

  return (
    <div className="space-y-4">
      {d.documents.length === 0 ? (
        <EmptyState
          title="No documents"
          description="Paperwork the school uploads for you appears here."
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {d.documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.type} · {Math.round(doc.sizeBytes / 1024)} KB
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer">
                  Download
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Self-describing stub (the M09/M19 pattern): say what is missing and
          why, rather than render an empty section that reads as a bug. */}
      {!d.certificates.available && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Certificates: {d.certificates.reason}.
        </p>
      )}
    </div>
  );
}

function ProfilePanel({ fetchers }: { fetchers: StudentFetchers }) {
  const q = useQuery({
    queryKey: ["portal", fetchers.key, "profile"],
    queryFn: fetchers.profile,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const s = d.student;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 rounded-md border p-4">
        {s.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.photoUrl}
            alt=""
            className="size-20 rounded object-cover"
          />
        ) : (
          <div className="grid size-20 place-items-center rounded bg-muted text-xs text-muted-foreground">
            No photo
          </div>
        )}
        <div>
          <p className="text-lg font-medium">{s.name}</p>
          <p className="text-sm text-muted-foreground">{s.studentUid}</p>
          <Badge variant="secondary" className="mt-1">
            {s.status}
          </Badge>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-md border p-4 text-sm sm:grid-cols-2">
        <Row label="Class">
          {d.enrollment
            ? `${d.enrollment.className} · ${d.enrollment.sectionName} · Roll ${d.enrollment.rollNo}`
            : "Not enrolled"}
        </Row>
        <Row label="Date of birth">{String(s.dob).slice(0, 10)}</Row>
        <Row label="Gender">{s.gender}</Row>
        <Row label="Religion">{s.religion ?? "—"}</Row>
        <Row label="Blood group">{s.bloodGroup ?? "—"}</Row>
        <Row label="Admitted">{String(s.admissionDate).slice(0, 10)}</Row>
        <Row label="Phone">{d.contact.phone ?? "—"}</Row>
        <Row label="Email">{d.contact.email ?? "—"}</Row>
        <Row label="Present address">{s.presentAddress ?? "—"}</Row>
        <Row label="Permanent address">{s.permanentAddress ?? "—"}</Row>
      </dl>

      <div className="rounded-md border p-4">
        <h3 className="mb-3 text-sm font-medium">Guardians</h3>
        {d.guardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">None linked.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {d.guardians.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{g.name}</span>
                <span className="text-muted-foreground">
                  {g.relation} · {g.phone}
                </span>
                {g.isPrimary && <Badge variant="secondary">Primary</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Something wrong? Ask the school office to correct it — a portal
        account cannot edit its own record.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word">{children}</dd>
    </div>
  );
}
