"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AxiosError } from "axios";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi } from "@/lib/api/structure";
import {
  teacherAssignmentsApi,
  teachersApi,
  type Teacher,
} from "@/lib/api/teachers";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { usePermissions } from "@/lib/hooks/use-permissions";

const UNASSIGNED = "__unassigned__";

/**
 * Assignment matrix (roadmap M08 §5): pick a section → the session's
 * curriculum subjects each get a teacher dropdown. Expertise-matching
 * teachers are marked ★; picking a non-expert prompts for the override.
 */
export default function AssignmentMatrixPage() {
  const { selected: session } = useAcademicSession();
  const queryClient = useQueryClient();
  const { can, isSuperAdmin } = usePermissions();
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [overridePrompt, setOverridePrompt] = useState<{
    subjectId: string;
    teacher: Teacher;
  } | null>(null);

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100, sort: "numericLevel:asc" }),
    staleTime: 60_000,
  });
  const sections = useQuery({
    queryKey: ["sections", { classId, sessionId: session?.id }],
    queryFn: () =>
      structureApi.sections.list({
        classId,
        sessionId: session!.id,
        limit: 100,
      }),
    enabled: !!classId && !!session,
  });
  const curriculum = useQuery({
    queryKey: ["class-subjects", classId, session?.id],
    queryFn: () => structureApi.getClassSubjects(classId, session!.id),
    enabled: !!classId && !!session,
  });
  const teachers = useQuery({
    queryKey: ["teachers", "active-all"],
    queryFn: () => teachersApi.list({ status: "ACTIVE", limit: 100 }),
    staleTime: 60_000,
  });
  const assignments = useQuery({
    queryKey: ["teacher-assignments", { sessionId: session?.id, sectionId }],
    queryFn: () =>
      teacherAssignmentsApi.list({ sessionId: session!.id, sectionId }),
    enabled: !!sectionId && !!session,
  });
  const workload = useQuery({
    queryKey: ["teacher-workload", session?.id],
    queryFn: () => teacherAssignmentsApi.workload(session!.id),
    enabled: !!session,
  });

  const assign = useMutation({
    mutationFn: (input: {
      subjectId: string;
      teacherId: string;
      override?: boolean;
    }) =>
      teacherAssignmentsApi.assign({
        sessionId: session!.id,
        sectionId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        override: input.override,
      }),
    onSuccess: () => {
      toast.success("Assignment saved");
      void queryClient.invalidateQueries({ queryKey: ["teacher-assignments"] });
      void queryClient.invalidateQueries({ queryKey: ["teacher-workload"] });
    },
    onError: (err, input) => {
      const status = (err as AxiosError).response?.status;
      const teacher = teachers.data?.data.find(
        (t) => t.id === input.teacherId,
      );
      // Expertise mismatch → offer the override to those who hold it.
      if (
        status === 409 &&
        !input.override &&
        teacher &&
        (can("teacher.assign.override") || isSuperAdmin)
      ) {
        setOverridePrompt({ subjectId: input.subjectId, teacher });
        return;
      }
      toast.error(apiErrorMessage(err));
    },
  });

  const unassign = useMutation({
    mutationFn: (id: string) => teacherAssignmentsApi.remove(id),
    onSuccess: () => {
      toast.success("Assignment removed");
      void queryClient.invalidateQueries({ queryKey: ["teacher-assignments"] });
      void queryClient.invalidateQueries({ queryKey: ["teacher-workload"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const holderBySubject = new Map(
    (assignments.data ?? []).map((a) => [a.subjectId, a]),
  );
  const expertiseOf = (teacher: Teacher) =>
    new Set(teacher.subjects.map((s) => s.subject.id));

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Assignment matrix"
        description="Who teaches which subject in which section — one teacher per slot; assigning an occupied slot replaces the holder"
      />

      {!session ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Pick an academic session in the header first.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Select
              value={classId || undefined}
              onValueChange={(v) => {
                setClassId(v);
                setSectionId("");
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Pick a class" />
              </SelectTrigger>
              <SelectContent>
                {(classes.data?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sectionId || undefined}
              onValueChange={setSectionId}
              disabled={!classId}
            >
              <SelectTrigger className="w-52">
                <SelectValue
                  placeholder={classId ? "Pick a section" : "Class first"}
                />
              </SelectTrigger>
              <SelectContent>
                {(sections.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Section {s.name}
                    {s.shift ? ` (${s.shift.name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sectionId ? (
            curriculum.isPending || assignments.isPending ? (
              <LoadingBlock />
            ) : curriculum.isError || assignments.isError ? (
              <ErrorState
                error={curriculum.error ?? assignments.error}
                onRetry={() => {
                  void curriculum.refetch();
                  void assignments.refetch();
                }}
              />
            ) : (curriculum.data ?? []).length === 0 ? (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                This class has no subjects mapped for session {session.name} —
                assign the curriculum first (Academic Structure → class →
                Subjects).
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2 font-medium">Subject</th>
                      <th className="px-3 py-2 font-medium">Teacher</th>
                      <th className="px-3 py-2 font-medium">Expertise</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(curriculum.data ?? []).map((row) => {
                      const holder = holderBySubject.get(row.subjectId);
                      const holderTeacher = teachers.data?.data.find(
                        (t) => t.id === holder?.teacherId,
                      );
                      return (
                        <tr key={row.id}>
                          <td className="px-3 py-2 font-medium">
                            {row.subject.name}{" "}
                            <Badge variant="outline">{row.subject.code}</Badge>
                            {row.isOptional ? (
                              <Badge variant="secondary" className="ml-1">
                                Optional
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={holder?.teacherId ?? UNASSIGNED}
                              disabled={!can("teacher.assign")}
                              onValueChange={(v) => {
                                if (v === UNASSIGNED) {
                                  if (holder) unassign.mutate(holder.id);
                                } else {
                                  assign.mutate({
                                    subjectId: row.subjectId,
                                    teacherId: v,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="w-72">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNASSIGNED}>
                                  — Unassigned —
                                </SelectItem>
                                {(teachers.data?.data ?? []).map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {expertiseOf(t).has(row.subjectId)
                                      ? "★ "
                                      : ""}
                                    {t.firstName} {t.lastName} ({t.employeeId})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            {holderTeacher ? (
                              expertiseOf(holderTeacher).has(row.subjectId) ? (
                                <Badge>Matches</Badge>
                              ) : (
                                <Badge variant="destructive">Overridden</Badge>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              Workload (session {session.name})
            </h2>
            <p className="text-sm text-muted-foreground">
              Assignment counts — periods/week arrive with the timetable
              (Module 13).
            </p>
            {workload.isPending ? (
              <LoadingBlock />
            ) : (workload.data ?? []).length === 0 ? (
              <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No assignments yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2 font-medium">Teacher</th>
                      <th className="px-3 py-2 font-medium">Employee ID</th>
                      <th className="px-3 py-2 font-medium">Assignments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(workload.data ?? []).map((row) => (
                      <tr key={row.teacherId}>
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2">{row.employeeId}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.assignments}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={overridePrompt !== null}
        onOpenChange={(open) => !open && setOverridePrompt(null)}
        title="Assign outside expertise?"
        description={`${overridePrompt?.teacher.firstName} ${overridePrompt?.teacher.lastName} does not have this subject in their expertise set. Assign anyway (recorded in the audit log)?`}
        confirmLabel="Assign anyway"
        isPending={assign.isPending}
        onConfirm={() => {
          if (overridePrompt) {
            assign.mutate({
              subjectId: overridePrompt.subjectId,
              teacherId: overridePrompt.teacher.id,
              override: true,
            });
            setOverridePrompt(null);
          }
        }}
      />
    </main>
  );
}
