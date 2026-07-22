"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi } from "@/lib/api/structure";
import { teacherAssignmentsApi } from "@/lib/api/teachers";
import {
  conflictsFromError,
  timetableApi,
  type EntryInput,
  type RoutineConflict,
  type Weekday,
} from "@/lib/api/timetable";
import { cn } from "@/lib/utils";
import {
  CONFLICT_KIND_LABELS,
  cellKey,
  indexConflicts,
  isTeachable,
  TIMETABLE_STATUS_LABELS,
  WEEKDAY_SHORT,
} from "@/lib/validations/timetable";

/**
 * The routine builder: a days × periods grid whose cells are edited in a
 * popover. All edits are local until "Save grid" — the backend replaces
 * the draft's cells wholesale and refuses the whole payload if anything
 * conflicts, so partial saves can never leave a half-valid routine.
 */
export default function TimetableBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const router = useRouter();

  const detail = useQuery({
    queryKey: ["timetable", id],
    queryFn: () => timetableApi.get(id),
  });

  const [editing, setEditing] = useState<{
    day: Weekday;
    slotId: string;
  } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveConflicts, setSaveConflicts] = useState<RoutineConflict[]>([]);

  // Local grid state. Seeded from the server payload on first load and
  // whenever the timetable id changes — deriving during render (rather
  // than in an effect) keeps the React Compiler happy, the M12 pattern.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [cells, setCells] = useState<Map<string, EntryInput>>(new Map());
  const [dirty, setDirty] = useState(false);

  if (detail.data && loadedFor !== detail.data.timetable.id) {
    setLoadedFor(detail.data.timetable.id);
    setCells(
      new Map(
        detail.data.entries.map((entry) => [
          cellKey(entry.day, entry.periodSlotId),
          {
            day: entry.day,
            periodSlotId: entry.periodSlotId,
            subjectId: entry.subjectId,
            teacherId: entry.teacherId,
            ...(entry.roomNo ? { roomNo: entry.roomNo } : {}),
            ...(entry.combinedWithSectionId
              ? { combinedWithSectionId: entry.combinedWithSectionId }
              : {}),
          },
        ]),
      ),
    );
    setDirty(false);
    setSaveConflicts([]);
  }

  const timetable = detail.data?.timetable;
  const sessionId = timetable?.sessionId ?? "";
  const isDraft = timetable?.status === "DRAFT";

  const curriculum = useQuery({
    queryKey: ["class-subjects", timetable?.section.class.id, sessionId],
    queryFn: () =>
      structureApi.getClassSubjects(timetable!.section.class.id, sessionId),
    enabled: !!timetable && !!sessionId,
  });

  // Who officially owns each subject in this section (M08). Used to
  // pre-select the teacher and to warn before an override is needed.
  const assignments = useQuery({
    queryKey: ["teacher-assignments", sessionId, timetable?.sectionId],
    queryFn: () =>
      teacherAssignmentsApi.list({
        sessionId,
        sectionId: timetable!.sectionId,
      }),
    enabled: !!timetable && !!sessionId,
  });

  const save = useMutation({
    mutationFn: (override: boolean) =>
      timetableApi.replaceEntries(id, {
        entries: [...cells.values()],
        override,
      }),
    onSuccess: (result) => {
      setDirty(false);
      setSaveConflicts([]);
      toast.success(
        result.unassignedOverrides.length > 0
          ? `Saved ${result.saved} cell(s) — ${result.unassignedOverrides.length} used an unassigned teacher.`
          : `Saved ${result.saved} cell(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["timetable", id] });
    },
    onError: (err) => {
      const conflicts = conflictsFromError(err);
      setSaveConflicts(conflicts);
      toast.error(apiErrorMessage(err));
    },
  });

  const publish = useMutation({
    mutationFn: (effectiveFrom: string) =>
      timetableApi.publish(id, effectiveFrom ? { effectiveFrom } : {}),
    onSuccess: () => {
      toast.success("Routine published — the previous version is archived.");
      setPublishOpen(false);
      void qc.invalidateQueries({ queryKey: ["timetable", id] });
      void qc.invalidateQueries({ queryKey: ["timetables"] });
    },
    onError: (err) => {
      setSaveConflicts(conflictsFromError(err));
      toast.error(apiErrorMessage(err));
    },
  });

  const discard = useMutation({
    mutationFn: () => timetableApi.remove(id),
    onSuccess: () => {
      toast.success("Draft discarded.");
      router.push("/admin/timetables");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  // Saved conflicts come from the last read; unsaved ones from the last
  // rejected save. Showing both means a cell stays red until it is fixed.
  const conflictIndex = useMemo(
    () => indexConflicts([...(detail.data?.conflicts ?? []), ...saveConflicts]),
    [detail.data?.conflicts, saveConflicts],
  );

  if (detail.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (detail.isError || !detail.data || !timetable) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void detail.refetch()} />
      </main>
    );
  }

  const { slots, days } = detail.data;
  const classSlots = slots.filter((slot) => isTeachable(slot.type));
  const capacity = classSlots.length * days.length;
  const subjectOptions = (curriculum.data ?? []).map((row) => ({
    id: row.subject.id,
    name: row.subject.name,
  }));

  const setCell = (key: string, value: EntryInput | null) => {
    setCells((prev) => {
      const next = new Map(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
    setDirty(true);
  };

  /** Copy a whole day onto another — the common "Sun = Sat" shortcut. */
  const copyDay = (from: Weekday, to: Weekday) => {
    setCells((prev) => {
      const next = new Map(prev);
      for (const slot of classSlots) {
        next.delete(cellKey(to, slot.id));
        const source = prev.get(cellKey(from, slot.id));
        if (source) {
          next.set(cellKey(to, slot.id), { ...source, day: to });
        }
      }
      return next;
    });
    setDirty(true);
  };

  const clearDay = (day: Weekday) => {
    setCells((prev) => {
      const next = new Map(prev);
      for (const slot of classSlots) next.delete(cellKey(day, slot.id));
      return next;
    });
    setDirty(true);
  };

  return (
    <main className="flex-1 space-y-6 p-8 pb-28">
      <PageHeader
        title={`${timetable.section.class.name} — ${timetable.section.name}`}
        description={`${timetable.session.name} · v${timetable.version} · effective from ${timetable.effectiveFrom}${
          timetable.section.shift ? ` · ${timetable.section.shift.name} shift` : ""
        }`}
      >
        <Badge variant={isDraft ? "secondary" : "default"}>
          {TIMETABLE_STATUS_LABELS[timetable.status]}
        </Badge>
        <Can permission="timetable.export">
          <Button
            variant="outline"
            onClick={() =>
              void timetableApi
                .downloadPdf(id)
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Print
          </Button>
        </Can>
        {isDraft ? (
          <>
            <Can permission="timetable.manage">
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                disabled={discard.isPending}
              >
                Discard
              </Button>
            </Can>
            <Can permission="timetable.publish">
              <Button
                disabled={dirty || cells.size === 0}
                onClick={() => setPublishOpen(true)}
              >
                Publish
              </Button>
            </Can>
          </>
        ) : null}
      </PageHeader>

      {!isDraft ? (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
          This version is {TIMETABLE_STATUS_LABELS[timetable.status].toLowerCase()}{" "}
          and read-only. Create a new draft from the routines list to change it.
        </div>
      ) : null}

      {dirty ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Unsaved changes. Publishing is disabled until the grid is saved.
        </div>
      ) : null}

      {conflictIndex.size > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <strong>
            {[...conflictIndex.values()].flat().length} conflict(s)
          </strong>{" "}
          — the red cells below cannot be saved. Hover one for the reason.
        </div>
      ) : null}

      {classSlots.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          This section&apos;s shift has no class periods yet.{" "}
          <Link
            href="/admin/timetables/periods"
            className="underline underline-offset-4"
          >
            Define its bell schedule
          </Link>{" "}
          first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-40 p-3 text-left font-medium">Period</th>
                {days.map((day) => (
                  <th key={day} className="p-3 text-left font-medium">
                    <div className="flex items-center justify-between gap-2">
                      <span>{WEEKDAY_SHORT[day]}</span>
                      {isDraft ? (
                        <DayMenu
                          day={day}
                          days={days}
                          onCopy={(from) => copyDay(from, day)}
                          onClear={() => clearDay(day)}
                        />
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id} className="border-b last:border-b-0">
                  <td className="p-3 align-top">
                    <div className="font-medium">{slot.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {slot.startTime}–{slot.endTime}
                    </div>
                  </td>
                  {isTeachable(slot.type) ? (
                    days.map((day) => {
                      const key = cellKey(day, slot.id);
                      const cell = cells.get(key);
                      const cellConflicts = conflictIndex.get(key) ?? [];
                      return (
                        <td key={day} className="p-1.5 align-top">
                          <GridCell
                            entry={cell}
                            conflicts={cellConflicts}
                            editable={isDraft}
                            subjectName={
                              subjectOptions.find(
                                (s) => s.id === cell?.subjectId,
                              )?.name
                            }
                            teacherName={
                              (assignments.data ?? []).find(
                                (a) => a.teacher.id === cell?.teacherId,
                              )?.teacher
                                ? `${
                                    (assignments.data ?? []).find(
                                      (a) => a.teacher.id === cell?.teacherId,
                                    )!.teacher.firstName
                                  } ${
                                    (assignments.data ?? []).find(
                                      (a) => a.teacher.id === cell?.teacherId,
                                    )!.teacher.lastName
                                  }`
                                : undefined
                            }
                            onClick={() =>
                              setEditing({ day, slotId: slot.id })
                            }
                          />
                        </td>
                      );
                    })
                  ) : (
                    <td
                      colSpan={days.length}
                      className="bg-muted/30 p-3 text-center text-xs uppercase tracking-wide text-muted-foreground"
                    >
                      {slot.type}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDraft ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {cells.size} of {capacity} slot(s) filled
            </span>
            {conflictIndex.size > 0 ? (
              <Badge variant="destructive">
                {[...conflictIndex.values()].flat().length} conflict(s)
              </Badge>
            ) : null}
            <Can permission="timetable.manage">
              <Button
                className="ml-auto"
                disabled={save.isPending}
                onClick={() => save.mutate(true)}
              >
                {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
                Save grid
              </Button>
            </Can>
          </div>
        </div>
      ) : null}

      {editing ? (
        <CellEditor
          day={editing.day}
          slot={slots.find((s) => s.id === editing.slotId)!}
          sessionId={sessionId}
          sectionId={timetable.sectionId}
          value={cells.get(cellKey(editing.day, editing.slotId)) ?? null}
          subjects={subjectOptions}
          assignments={assignments.data ?? []}
          onClose={() => setEditing(null)}
          onSave={(entry) => {
            setCell(cellKey(editing.day, editing.slotId), entry);
            setEditing(null);
          }}
        />
      ) : null}

      {publishOpen ? (
        <PublishDialog
          defaultDate={timetable.effectiveFrom}
          filled={cells.size}
          capacity={capacity}
          isPending={publish.isPending}
          onClose={() => setPublishOpen(false)}
          onConfirm={(date) => publish.mutate(date)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Discard this draft?"
        description="The published version stays in force. This cannot be undone."
        confirmLabel="Discard"
        destructive
        isPending={discard.isPending}
        onConfirm={() => discard.mutate()}
      />
    </main>
  );
}

function GridCell({
  entry,
  conflicts,
  editable,
  subjectName,
  teacherName,
  onClick,
}: {
  entry: EntryInput | undefined;
  conflicts: RoutineConflict[];
  editable: boolean;
  subjectName?: string;
  teacherName?: string;
  onClick: () => void;
}) {
  const body = (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      className={cn(
        "min-h-16 w-full rounded-md border p-2 text-left transition",
        editable ? "hover:border-primary hover:bg-accent" : "cursor-default",
        entry ? "bg-card" : "border-dashed text-muted-foreground",
        conflicts.length > 0 && "border-destructive bg-destructive/10",
      )}
    >
      {entry ? (
        <>
          <div className="truncate font-medium">{subjectName ?? "Subject"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {teacherName ?? "Teacher"}
          </div>
          {entry.roomNo ? (
            <div className="truncate text-xs text-muted-foreground">
              Room {entry.roomNo}
            </div>
          ) : null}
        </>
      ) : (
        <span className="text-xs">{editable ? "+ Add" : "—"}</span>
      )}
    </button>
  );

  if (conflicts.length === 0) return body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-1">
          {conflicts.map((conflict, index) => (
            <li key={index}>
              <strong>{CONFLICT_KIND_LABELS[conflict.kind]}:</strong>{" "}
              {conflict.message}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function DayMenu({
  day,
  days,
  onCopy,
  onClear,
}: {
  day: Weekday;
  days: Weekday[];
  onCopy: (from: Weekday) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const others = days.filter((d) => d !== day);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        •••
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{WEEKDAY_SHORT[day]}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Copy another day onto this one, replacing whatever is here.
              </p>
              <div className="flex flex-wrap gap-2">
                {others.map((other) => (
                  <Button
                    key={other}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onCopy(other);
                      setOpen(false);
                    }}
                  >
                    From {WEEKDAY_SHORT[other]}
                  </Button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                Clear this day
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function CellEditor({
  day,
  slot,
  sessionId,
  sectionId,
  value,
  subjects,
  assignments,
  onClose,
  onSave,
}: {
  day: Weekday;
  slot: { id: string; name: string; startTime: string; endTime: string };
  sessionId: string;
  sectionId: string;
  value: EntryInput | null;
  subjects: Array<{ id: string; name: string }>;
  assignments: Array<{
    subject: { id: string };
    teacher: { id: string; firstName: string; lastName: string };
  }>;
  onClose: () => void;
  onSave: (entry: EntryInput | null) => void;
}) {
  const [subjectId, setSubjectId] = useState(value?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState(value?.teacherId ?? "");
  const [roomNo, setRoomNo] = useState(value?.roomNo ?? "");
  const [combinedWith, setCombinedWith] = useState(
    value?.combinedWithSectionId ?? "",
  );

  const teachers = useQuery({
    queryKey: ["teachers", "options"],
    queryFn: () => teacherAssignmentsApi.list({ sessionId }),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const sections = useQuery({
    queryKey: ["sections", "combined", sessionId],
    queryFn: () => structureApi.sections.list({ sessionId, limit: 200 }),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  /** The teacher M08 says owns this subject here — the default choice. */
  const owner = assignments.find((a) => a.subject.id === subjectId)?.teacher;

  // Every teacher who holds any duty this session, so a substitute can be
  // picked; the owner is marked so the override case is visible.
  const teacherOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of teachers.data ?? []) {
      seen.set(
        row.teacher.id,
        `${row.teacher.firstName} ${row.teacher.lastName}`,
      );
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [teachers.data]);

  const probe = useQuery({
    queryKey: ["timetable-conflicts", sessionId, teacherId, day, slot.id],
    queryFn: () =>
      timetableApi.conflicts({
        sessionId,
        teacherId,
        day,
        periodSlotId: slot.id,
        sectionId,
        ...(roomNo ? { roomNo } : {}),
      }),
    enabled: !!teacherId && !!sessionId,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {WEEKDAY_SHORT[day]} · {slot.name} ({slot.startTime}–{slot.endTime})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Subject</Label>
          <Select
            value={subjectId || undefined}
            onValueChange={(v) => {
              setSubjectId(v);
              // Jump straight to the assigned teacher — the common case.
              const next = assignments.find((a) => a.subject.id === v)?.teacher;
              if (next) setTeacherId(next.id);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {subjects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No subjects mapped to this class for the session — set the
              curriculum under Academic Structure first.
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label>Teacher</Label>
          <Select
            value={teacherId || undefined}
            onValueChange={setTeacherId}
            disabled={!subjectId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a teacher" />
            </SelectTrigger>
            <SelectContent>
              {teacherOptions.map((teacher) => (
                <SelectItem key={teacher.id} value={teacher.id}>
                  {teacher.id === owner?.id ? "★ " : ""}
                  {teacher.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teacherId && owner && teacherId !== owner.id ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Not the assigned teacher for this subject — saving needs the
              override permission.
            </p>
          ) : null}
          {(probe.data ?? []).length > 0 ? (
            <ul className="space-y-0.5 text-xs text-destructive">
              {(probe.data ?? []).map((conflict, index) => (
                <li key={index}>{conflict.message}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label htmlFor="cell-room">Room (optional)</Label>
          <Input
            id="cell-room"
            value={roomNo}
            maxLength={20}
            placeholder="Defaults to the section's room"
            onChange={(e) => setRoomNo(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>Combined with (optional)</Label>
          <Select
            value={combinedWith || "NONE"}
            onValueChange={(v) => setCombinedWith(v === "NONE" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Not a combined class</SelectItem>
              {(sections.data?.data ?? [])
                .filter((s) => s.id !== sectionId)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.class?.name ?? "Class"} — {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Marks two sections sitting the same lesson, so the shared teacher
            is not reported as double-booked.
          </p>
        </div>

        <DialogFooter>
          {value ? (
            <Button variant="outline" onClick={() => onSave(null)}>
              Clear cell
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!subjectId || !teacherId}
            onClick={() =>
              onSave({
                day,
                periodSlotId: slot.id,
                subjectId,
                teacherId,
                ...(roomNo.trim() ? { roomNo: roomNo.trim() } : {}),
                ...(combinedWith
                  ? { combinedWithSectionId: combinedWith }
                  : {}),
              })
            }
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({
  defaultDate,
  filled,
  capacity,
  isPending,
  onClose,
  onConfirm,
}: {
  defaultDate: string;
  filled: number;
  capacity: number;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (effectiveFrom: string) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [acknowledged, setAcknowledged] = useState(false);
  const gaps = capacity - filled;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish this routine</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Publishing makes this the routine everyone sees and archives the
            version it replaces. The old version stays readable as history.
          </p>
          <div className="rounded-md border p-3">
            <div className="flex justify-between">
              <span>Filled slots</span>
              <strong>
                {filled} / {capacity}
              </strong>
            </div>
            {gaps > 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {gaps} free period(s) will print as blank cells.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="publish-date">Effective from</Label>
            <Input
              id="publish-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {gaps > 0 ? (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
              />
              Publish with free periods
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending || (gaps > 0 && !acknowledged)}
            onClick={() => onConfirm(date)}
          >
            {isPending ? <Spinner className="mr-1 size-4" /> : null}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
