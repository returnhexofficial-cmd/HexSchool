"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { portalApi } from "@/lib/api/portal";
import { portalAssignmentApi } from "@/lib/api/assignment";
import { AssignmentPanels } from "./assignment-panels";
import { LibraryPanels } from "./library-panels";
import { opacApi } from "@/lib/api/library";
import { StudentPanels } from "./student-panels";

export default function PortalHomePage() {
  const me = useQuery({ queryKey: ["portal", "me"], queryFn: portalApi.me });

  if (me.isLoading) {
    return (
      <div className="p-8">
        <LoadingBlock />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="p-8">
        <ErrorState onRetry={() => void me.refetch()} />
      </div>
    );
  }

  const principal = me.data!;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {principal.userType === "STUDENT" ? (
        <StudentView />
      ) : principal.userType === "PARENT" ? (
        <ParentView kids={principal.children} />
      ) : principal.userType === "TEACHER" ? (
        <TeacherView />
      ) : (
        <EmptyState
          title="Portal"
          description="This account is not a student, parent, or teacher."
        />
      )}
    </div>
  );
}

// ── student ──────────────────────────────────────────────────────────────

function StudentView() {
  return (
    <>
      <PageHeader title="My portal" description="Attendance, results, dues and routine." />
      <StudentPanels
        fetchers={{
          key: "self",
          overview: portalApi.studentOverview,
          attendance: portalApi.studentAttendance,
          results: portalApi.studentResults,
          dues: portalApi.studentDues,
          routine: portalApi.studentRoutine,
          profile: portalApi.studentProfile,
          documents: portalApi.studentDocuments,
          reportCard: (examId) => portalApi.studentReportCard(examId),
          pay: (invoiceIds, gateway) => portalApi.studentPay(invoiceIds, gateway),
        }}
      />
      <AssignmentPanels
        canSubmit
        fetchers={{
          key: "self",
          list: (tab) => portalAssignmentApi.list({ tab }),
          materials: () => portalAssignmentApi.materials(),
          submit: (id, input) => portalAssignmentApi.submit(id, input),
          upload: (file) => portalAssignmentApi.uploadAttachment(file),
        }}
      />
      <LibraryPanels fetchers={{ key: "self", me: opacApi.me }} />
      <MessagesPanel />
      <ContactSchoolCard />
    </>
  );
}

// ── parent ───────────────────────────────────────────────────────────────

function ParentView({
  kids,
}: {
  kids: { studentId: string; name: string; photoUrl: string | null }[];
}) {
  const [selected, setSelected] = useState(kids[0]?.studentId ?? null);

  if (kids.length === 0) {
    return (
      <EmptyState
        title="No children linked"
        description="Ask the school office to link your child to this account."
      />
    );
  }

  return (
    <>
      <PageHeader title="Parent portal" description="Follow each child’s progress." />
      {kids.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {kids.map((c) => (
            <Button
              key={c.studentId}
              variant={selected === c.studentId ? "default" : "outline"}
              size="sm"
              onClick={() => setSelected(c.studentId)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      )}
      {selected && (
        <StudentPanels
          key={selected}
          fetchers={{
            key: `child-${selected}`,
            overview: () => portalApi.childOverview(selected),
            attendance: () => portalApi.childAttendance(selected),
            results: () => portalApi.childResults(selected),
            dues: () => portalApi.childDues(selected),
            routine: () => portalApi.childRoutine(selected),
            profile: () => portalApi.childProfile(selected),
            documents: () => portalApi.childDocuments(selected),
            reportCard: (examId) => portalApi.childReportCard(selected, examId),
            pay: (invoiceIds, gateway) =>
              portalApi.childPay(selected, invoiceIds, gateway),
          }}
        />
      )}
      {selected && (
        /* Read-only on purpose: a parent may see what is outstanding but
           never hand the work in — the record of who did it has to mean
           what it says, and the API refuses it regardless. */
        <AssignmentPanels
          key={`asg-${selected}`}
          canSubmit={false}
          fetchers={{
            key: `child-${selected}`,
            list: (tab) => portalAssignmentApi.childList(selected, { tab }),
            materials: () => portalAssignmentApi.childMaterials(selected),
          }}
        />
      )}
      {selected && (
        /* Read-only for the same reason the assignments panel is: the
           library card belongs to the reader. */
        <LibraryPanels
          key={`lib-${selected}`}
          fetchers={{
            key: `child-${selected}`,
            me: () => opacApi.childLibrary(selected),
            canAct: false,
          }}
        />
      )}
      <MessagesPanel />
      <ContactSchoolCard />
    </>
  );
}

// ── messages + contact (student & parent) ────────────────────────────────

/**
 * SMS/email history (roadmap M18 §5). Self-scoped server-side — there is
 * no id in the request, so a parent sees only what was sent to them.
 */
function MessagesPanel() {
  const q = useQuery({ queryKey: ["portal", "messages"], queryFn: portalApi.messages });
  if (q.isLoading || q.isError) return null;
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="rounded-md border p-4">
      <h3 className="mb-3 font-medium">Messages from school</h3>
      <ul className="space-y-3 text-sm">
        {items.slice(0, 10).map((m) => (
          <li key={m.id} className="border-b pb-2 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{m.channel}</Badge>
              <span>{String(m.sentAt ?? m.createdAt).slice(0, 16).replace("T", " ")}</span>
              <span>· {m.status}</span>
            </div>
            <p className="mt-1">{m.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Contact School" (roadmap M18 §5) — lands in the M19 office inbox, which
 * already has a UI and a NEW/READ/REPLIED flow. Module 28's ticket system
 * replaces this with a real thread.
 */
function ContactSchoolCard() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: () => portalApi.contactSchool(body, subject || undefined),
    onSuccess: (res) => {
      toast.success(res.message);
      setSubject("");
      setBody("");
    },
    onError: () => toast.error("Could not send the message"),
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <h3 className="font-medium">Contact the school</h3>
        <p className="text-sm text-muted-foreground">
          The office sees your name and phone from your account.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-subject">Subject</Label>
        <Input
          id="contact-subject"
          value={subject}
          maxLength={200}
          placeholder="Optional"
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-body">Message</Label>
        <Textarea
          id="contact-body"
          value={body}
          rows={4}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        disabled={body.trim().length < 5 || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}

// ── teacher ──────────────────────────────────────────────────────────────

function TeacherView() {
  const q = useQuery({
    queryKey: ["portal", "teacher", "overview"],
    queryFn: portalApi.teacherOverview,
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data!;

  return (
    <>
      <PageHeader
        title={`Welcome, ${d.teacher.name}`}
        description={`${d.session.name} · ${d.periodsPerWeek} periods/week`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Today’s periods" value={String(d.todayPeriods.length)} />
        <StatCard title="Free periods today" value={String(d.freeToday)} />
        <StatCard title="My sections" value={String(d.sections.length)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/admin/attendance">Take attendance</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/exams">Mark entry</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/timetables/master">Routine</Link>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Today’s classes</h3>
          {d.todayPeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes today.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.todayPeriods.map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.subject}</span>
                    <span className="text-muted-foreground"> · {p.section}</span>
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
          <h3 className="mb-3 font-medium">My sections</h3>
          <div className="flex flex-wrap gap-2">
            {d.sections.map((s) => (
              <Badge key={s.id} variant="secondary">
                {s.label}
              </Badge>
            ))}
          </div>
          <h3 className="mb-2 mt-4 font-medium">Notices</h3>
          <ul className="space-y-1 text-sm">
            {d.notices.map((n) => (
              <li key={n.id} className={cn(n.pinned && "font-medium")}>
                {n.title}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <MyStudentsPanel sections={d.sections} />
      {/* A teacher borrows books too — the library card belongs to a
          person, not to a student, so the same panel serves them. */}
      <LibraryPanels fetchers={{ key: "self", me: opacApi.me }} />
      <MyLeavesPanel />
      <MyPayslipsPanel />
    </>
  );
}

/**
 * "My Students" (roadmap M18 §5) — the roster of a section the teacher
 * actually teaches. The backend re-checks that from the published routine,
 * so picking a section id they do not teach is a 403, not a listing.
 */
function MyStudentsPanel({ sections }: { sections: { id: string; label: string }[] }) {
  const [sectionId, setSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const q = useQuery({
    queryKey: ["portal", "teacher", "roster", sectionId],
    queryFn: () => portalApi.teacherRoster(sectionId!),
    enabled: !!sectionId,
  });

  if (sections.length === 0) {
    return (
      <EmptyState
        title="No sections yet"
        description="Once the office assigns you subjects and publishes a routine, your students appear here."
      />
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">My students</h3>
        <Select value={sectionId ?? ""} onValueChange={setSectionId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Pick a section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No students enrolled.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Roll</th>
                <th className="p-2">Name</th>
                <th className="p-2">Student ID</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r) => (
                <tr key={r.enrollmentId} className="border-b last:border-0">
                  <td className="p-2 tabular-nums">{r.rollNo}</td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 font-mono text-xs">{r.studentUid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Own leave history, the balance strip and the apply form (roadmap M18
 * §5, rebuilt on the M21 leave system).
 *
 * Two things changed with M21 and both are visible here: the type is a
 * row with a real quota (so the form can show what is left before an
 * application is filed), and the panel serves **staff as well as
 * teachers** — the person is resolved from the logged-in account.
 */
function MyLeavesPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal", "employee", "leaves"],
    queryFn: portalApi.myLeaves,
  });
  const balances = useQuery({
    queryKey: ["portal", "employee", "leave-balances"],
    queryFn: portalApi.myLeaveBalances,
  });

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [reason, setReason] = useState("");

  const apply = useMutation({
    mutationFn: () =>
      portalApi.applyForLeave({ fromDate, toDate, leaveTypeId, reason }),
    onSuccess: () => {
      toast.success("Leave application submitted");
      setFromDate("");
      setToDate("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["portal", "employee"] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? "Could not submit the application";
      toast.error(message);
    },
  });

  const selected = balances.data?.find((b) => b.leaveType.id === leaveTypeId);

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="font-medium">My leaves</h3>

      {balances.data && balances.data.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {balances.data.map((b) => (
            <div key={b.leaveType.id} className="rounded-md border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {b.leaveType.name}
              </p>
              <p className="text-sm font-medium tabular-nums">
                {b.available} left
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="leave-from">From</Label>
          <Input
            id="leave-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leave-to">To</Label>
          <Input
            id="leave-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leave-type">Type</Label>
          <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
            <SelectTrigger id="leave-type">
              <SelectValue placeholder="Pick a type" />
            </SelectTrigger>
            <SelectContent>
              {(balances.data ?? []).map((b) => (
                <SelectItem key={b.leaveType.id} value={b.leaveType.id}>
                  {b.leaveType.name}
                  {b.leaveType.isPaid ? "" : " (unpaid)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected ? (
            <p className="text-xs text-muted-foreground">
              {selected.available} day(s) available
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="leave-reason">Reason</Label>
          <Input
            id="leave-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      <Button
        size="sm"
        disabled={
          !fromDate || !toDate || !leaveTypeId || reason.trim().length < 3 ||
          apply.isPending
        }
        onClick={() => apply.mutate()}
      >
        {apply.isPending ? "Submitting…" : "Apply for leave"}
      </Button>

      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No leave applications yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {q.data!.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="tabular-nums">
                {String(l.fromDate).slice(0, 10)} → {String(l.toDate).slice(0, 10)}
              </span>
              <Badge variant="outline">{l.leaveType.name}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Number(l.days)} day(s)
              </span>
              <Badge
                variant={
                  l.status === "APPROVED"
                    ? "secondary"
                    : l.status === "REJECTED"
                      ? "destructive"
                      : "outline"
                }
              >
                {l.status}
              </Badge>
              {l.reason && (
                <span className="text-muted-foreground">{l.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Payslip history (roadmap M21 §5). **Disbursed months only** — a draft
 * or merely approved payslip is a proposal the office is still working
 * on, and showing it would have people querying figures that are about
 * to change.
 */
function MyPayslipsPanel() {
  const q = useQuery({
    queryKey: ["portal", "employee", "payslips"],
    queryFn: portalApi.myPayslips,
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">My payslips</h3>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payslip has been disbursed yet.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {q.data!.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium tabular-nums">{p.month}</span>
              <span className="text-muted-foreground tabular-nums">
                gross {p.gross.toFixed(2)} · deductions{" "}
                {p.totalDeductions.toFixed(2)}
              </span>
              <span className="font-medium tabular-nums">
                net {p.netPayable.toFixed(2)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => void portalApi.downloadPayslip(p.id)}
              >
                PDF
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
