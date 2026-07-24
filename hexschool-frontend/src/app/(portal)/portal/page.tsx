"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { portalApi } from "@/lib/api/portal";
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
        }}
      />
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
          }}
        />
      )}
    </>
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
    </>
  );
}
