"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, List, Grid3X3 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
  academicApi,
  type CalendarEventType,
  type CalendarMonth,
  type HolidayType,
} from "@/lib/api/academic";
import { apiErrorMessage } from "@/lib/api/auth";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { buildMonthGrid, inRange, monthInfo } from "@/lib/utils/month-grid";
import { cn } from "@/lib/utils";
import {
  calendarEventSchema,
  holidaySchema,
  type CalendarEventValues,
  type HolidayValues,
} from "@/lib/validations/academic";

const EVENT_COLORS: Record<string, string> = {
  EXAM: "bg-red-500/15 text-red-700 dark:text-red-400",
  EVENT: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  MEETING: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  SPORTS: "bg-green-500/15 text-green-700 dark:text-green-400",
  CULTURAL: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  OTHER: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
};
const HOLIDAY_COLOR = "bg-amber-500/20 text-amber-800 dark:text-amber-300";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function CalendarPage() {
  const [month, setMonth] = useState(thisMonth());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const queryClient = useQueryClient();
  const { selected: session } = useAcademicSession();

  const query = useQuery({
    queryKey: ["calendar", month],
    queryFn: () => academicApi.calendarMonth(month),
  });
  const info = monthInfo(month);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });

  const downloadIcs = async () => {
    try {
      const ics = await academicApi.calendarIcs(month);
      const blob = new Blob([ics], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hexschool-${month}.ics`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Academic Calendar"
        description="Holidays and events — weekly off-days shaded automatically"
      >
        <Can permission="holiday.create">
          <Button variant="outline" onClick={() => setHolidayOpen(true)}>
            Add holiday
          </Button>
        </Can>
        <Can permission="event.create">
          <Button onClick={() => setEventOpen(true)}>Add event</Button>
        </Can>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth(info.prev)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-40 text-center font-medium">{info.label}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth(info.next)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth())}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("grid")}
          >
            <Grid3X3 className="size-4" /> Month
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("list")}
          >
            <List className="size-4" /> List
          </Button>
          <Button variant="outline" size="sm" onClick={() => void downloadIcs()}>
            <Download className="size-4" /> iCal
          </Button>
        </div>
      </div>

      {query.isPending ? (
        <LoadingBlock />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : view === "grid" ? (
        <MonthGrid month={month} data={query.data} />
      ) : (
        <MonthList data={query.data} onChanged={invalidate} />
      )}

      <HolidayDialog
        open={holidayOpen}
        onOpenChange={setHolidayOpen}
        sessionId={session?.id}
        onSaved={invalidate}
      />
      <EventDialog
        open={eventOpen}
        onOpenChange={setEventOpen}
        sessionId={session?.id}
        onSaved={invalidate}
      />
    </main>
  );
}

function MonthGrid({ month, data }: { month: string; data: CalendarMonth }) {
  const [y, m] = month.split("-").map(Number);
  const weeks = buildMonthGrid(y, m);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <th key={d} className="px-2 py-2 text-left font-medium">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {weeks.map((week, wi) => (
            <tr key={wi} className="divide-x align-top">
              {week.map((day) => {
                const weeklyOff = data.weeklyHolidays.includes(day.weekday);
                const holidays = data.holidays.filter((h) =>
                  inRange(day.iso, h.startDate, h.endDate),
                );
                const events = data.events.filter((e) =>
                  inRange(day.iso, e.startDate, e.endDate),
                );
                return (
                  <td
                    key={day.iso}
                    className={cn(
                      "h-24 px-1.5 py-1",
                      !day.inMonth && "bg-muted/30 text-muted-foreground",
                      day.inMonth && weeklyOff && "bg-amber-500/5",
                    )}
                  >
                    <div className="mb-1 text-xs tabular-nums">
                      {day.dayOfMonth}
                    </div>
                    <div className="space-y-0.5">
                      {holidays.map((h) => (
                        <div
                          key={h.id}
                          title={h.title}
                          className={cn(
                            "truncate rounded px-1 text-xs",
                            HOLIDAY_COLOR,
                          )}
                        >
                          {h.title}
                        </div>
                      ))}
                      {events.map((e) => (
                        <div
                          key={e.id}
                          title={e.title}
                          className={cn(
                            "truncate rounded px-1 text-xs",
                            EVENT_COLORS[e.type] ?? EVENT_COLORS.OTHER,
                          )}
                        >
                          {e.title}
                        </div>
                      ))}
                    </div>
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

function MonthList({
  data,
  onChanged,
}: {
  data: CalendarMonth;
  onChanged: () => void;
}) {
  const removeHoliday = useMutation({
    mutationFn: (id: string) => academicApi.deleteHoliday(id),
    onSuccess: () => {
      toast.success("Holiday removed");
      onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });
  const removeEvent = useMutation({
    mutationFn: (id: string) => academicApi.deleteEvent(id),
    onSuccess: () => {
      toast.success("Event removed");
      onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rows = [
    ...data.holidays.map((h) => ({ kind: "holiday" as const, item: h })),
    ...data.events.map((e) => ({ kind: "event" as const, item: e })),
  ].sort((a, b) => a.item.startDate.localeCompare(b.item.startDate));

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        Nothing scheduled this month.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map(({ kind, item }) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          <span className="w-44 shrink-0 tabular-nums text-muted-foreground">
            {item.startDate.slice(0, 10)}
            {item.endDate.slice(0, 10) !== item.startDate.slice(0, 10)
              ? ` → ${item.endDate.slice(0, 10)}`
              : ""}
          </span>
          <Badge
            variant="outline"
            className={cn(
              kind === "holiday"
                ? HOLIDAY_COLOR
                : EVENT_COLORS[(item as { type: string }).type] ??
                    EVENT_COLORS.OTHER,
              "border-0",
            )}
          >
            {kind === "holiday"
              ? `HOLIDAY · ${(item as { type: string }).type}`
              : (item as { type: string }).type}
          </Badge>
          <span className="min-w-0 flex-1 truncate font-medium">
            {item.title}
          </span>
          <Can permission={kind === "holiday" ? "holiday.delete" : "event.delete"}>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() =>
                kind === "holiday"
                  ? removeHoliday.mutate(item.id)
                  : removeEvent.mutate(item.id)
              }
            >
              Remove
            </Button>
          </Can>
        </li>
      ))}
    </ul>
  );
}

function HolidayDialog({
  open,
  onOpenChange,
  sessionId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | undefined;
  onSaved: () => void;
}) {
  const form = useForm<HolidayValues>({
    resolver: zodResolver(holidaySchema),
    defaultValues: {
      title: "",
      startDate: "",
      endDate: "",
      type: "SCHOOL",
      appliesTo: "ALL",
    },
  });

  const save = useMutation({
    mutationFn: (values: HolidayValues) => {
      if (!sessionId) throw new Error("Select an academic session first");
      return academicApi.createHoliday({ sessionId, ...values });
    },
    onSuccess: () => {
      toast.success("Holiday added");
      onOpenChange(false);
      form.reset();
      onSaved();
    },
    onError: (err) =>
      toast.error(err instanceof Error && !("response" in err) ? err.message : apiErrorMessage(err)),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add holiday"
      description={`Must fall within the selected session${sessionId ? "" : " — select a session in the header first"}.`}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      submitLabel="Add holiday"
      isPending={save.isPending}
    >
      <div className="space-y-2">
        <Label htmlFor="holiday-title">Title</Label>
        <Input id="holiday-title" placeholder="Victory Day" {...form.register("title")} />
        {form.formState.errors.title ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.title.message}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="holiday-start">From</Label>
          <Input id="holiday-start" type="date" {...form.register("startDate")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="holiday-end">To</Label>
          <Input id="holiday-end" type="date" {...form.register("endDate")} />
        </div>
      </div>
      {form.formState.errors.endDate ? (
        <p className="text-sm text-destructive">
          {form.formState.errors.endDate.message}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <TypeSelect
          label="Type"
          value={form.watch("type")}
          options={["GOVERNMENT", "RELIGIOUS", "SCHOOL", "WEEKLY"]}
          onChange={(v) => form.setValue("type", v as HolidayType)}
        />
        <TypeSelect
          label="Applies to"
          value={form.watch("appliesTo")}
          options={["ALL", "STUDENTS", "STAFF"]}
          onChange={(v) =>
            form.setValue("appliesTo", v as HolidayValues["appliesTo"])
          }
        />
      </div>
    </FormDialog>
  );
}

function EventDialog({
  open,
  onOpenChange,
  sessionId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | undefined;
  onSaved: () => void;
}) {
  const form = useForm<CalendarEventValues>({
    resolver: zodResolver(calendarEventSchema),
    defaultValues: {
      title: "",
      description: "",
      startDate: "",
      endDate: "",
      type: "EVENT",
      isPublic: false,
    },
  });

  const save = useMutation({
    mutationFn: (values: CalendarEventValues) => {
      if (!sessionId) throw new Error("Select an academic session first");
      return academicApi.createEvent({
        sessionId,
        ...values,
        description: values.description || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Event added");
      onOpenChange(false);
      form.reset();
      onSaved();
    },
    onError: (err) =>
      toast.error(err instanceof Error && !("response" in err) ? err.message : apiErrorMessage(err)),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add event"
      form={form}
      onSubmit={(values) => save.mutate(values)}
      submitLabel="Add event"
      isPending={save.isPending}
    >
      <div className="space-y-2">
        <Label htmlFor="event-title">Title</Label>
        <Input id="event-title" placeholder="Annual Sports Day" {...form.register("title")} />
        {form.formState.errors.title ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.title.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-description">Description (optional)</Label>
        <Input id="event-description" {...form.register("description")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="event-start">From</Label>
          <Input id="event-start" type="date" {...form.register("startDate")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-end">To</Label>
          <Input id="event-end" type="date" {...form.register("endDate")} />
        </div>
      </div>
      {form.formState.errors.endDate ? (
        <p className="text-sm text-destructive">
          {form.formState.errors.endDate.message}
        </p>
      ) : null}
      <TypeSelect
        label="Type"
        value={form.watch("type")}
        options={["EXAM", "EVENT", "MEETING", "SPORTS", "CULTURAL", "OTHER"]}
        onChange={(v) => form.setValue("type", v as CalendarEventType)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={form.watch("isPublic")}
          onChange={(e) => form.setValue("isPublic", e.target.checked)}
        />
        Show on the public website (Module 19)
      </label>
    </FormDialog>
  );
}

function TypeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
