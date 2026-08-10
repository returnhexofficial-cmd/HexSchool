"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import {
  analyticsApi,
  type ReportFormat,
  type ReportSchedule,
} from "@/lib/api/analytics";
import { apiErrorMessage } from "@/lib/api/auth";
import { describeCron, scheduleSchema } from "@/lib/validations/analytics";
import {
  ReportParamsForm,
  toParamPayload,
  type ParamValues,
} from "./report-params";

/**
 * Create or edit a schedule (roadmap §5's schedule manager).
 *
 * The shell is split from the form so the form can be **keyed** on the row
 * it is editing. Seeding a dozen `useState`s from props inside an effect
 * is the obvious way to write this and it is the wrong one — it is a
 * cascading render, React 19's lint says so, and the remount is both
 * simpler and impossible to get out of step with the props.
 */
export function ScheduleDialog({
  schedule,
  open,
  onOpenChange,
}: {
  schedule: ReportSchedule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {schedule ? "Edit schedule" : "Schedule a report"}
          </DialogTitle>
          <DialogDescription>
            Generated automatically and sent to the people you name.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ScheduleForm
            key={schedule?.id ?? "new"}
            schedule={schedule}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  schedule,
  onDone,
}: {
  schedule: ReportSchedule | null;
  onDone: () => void;
}) {
  const editing = schedule !== null;
  const queryClient = useQueryClient();

  const [reportCode, setReportCode] = useState(schedule?.reportCode ?? "");
  const [name, setName] = useState(schedule?.name ?? "");
  const [cron, setCron] = useState(schedule?.cron ?? "0 7 * * *");
  const [format, setFormat] = useState<ReportFormat>(
    schedule?.format ?? "XLSX",
  );
  const [emails, setEmails] = useState(
    (schedule?.recipients.emails ?? []).join(", "),
  );
  const [values, setValues] = useState<ParamValues>(() =>
    Object.fromEntries(
      Object.entries(schedule?.params ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: analyticsApi.reports,
  });
  const presets = useQuery({
    queryKey: ["cron-presets"],
    queryFn: analyticsApi.cronPresets,
  });

  // Only a runnable report can be scheduled — the engine refuses the rest,
  // so offering them here would be a form that cannot be submitted.
  const runnable = (reports.data ?? []).filter((r) => r.runnable);
  const selected = runnable.find((r) => r.code === reportCode) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const parsed = scheduleSchema.safeParse({
        reportCode,
        name,
        cron,
        format,
        emails,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      }
      const body = {
        name: parsed.data.name,
        cron: parsed.data.cron,
        format: parsed.data.format,
        params: toParamPayload(values),
        recipients: { emails: parsed.data.emails },
      };
      return editing
        ? analyticsApi.updateSchedule(schedule.id, body)
        : analyticsApi.createSchedule({ ...body, reportCode });
    },
    onSuccess: () => {
      toast.success(editing ? "Schedule updated" : "Report scheduled");
      void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      onDone();
    },
    onError: (err) => {
      // A Zod failure carries its own sentence; an axios one does not.
      const message =
        err instanceof Error && !("response" in err)
          ? err.message
          : apiErrorMessage(err);
      setError(message);
      toast.error(message);
    },
  });

  const reading = describeCron(cron);

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="schedule-report">Report</Label>
          <Select
            value={reportCode}
            onValueChange={setReportCode}
            disabled={editing}
          >
            <SelectTrigger id="schedule-report">
              <SelectValue placeholder="Choose a report…" />
            </SelectTrigger>
            <SelectContent>
              {runnable.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.module} — {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing && (
            <p className="text-xs text-muted-foreground">
              The report cannot be changed — remove this schedule and make a
              new one.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="schedule-name">Name</Label>
          <Input
            id="schedule-name"
            value={name}
            placeholder="Monthly dues for the committee"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-preset">Preset</Label>
            <Select
              value={presets.data?.find((p) => p.cron === cron)?.key ?? ""}
              onValueChange={(key) => {
                const preset = presets.data?.find((p) => p.key === key);
                if (preset) setCron(preset.cron);
              }}
            >
              <SelectTrigger id="schedule-preset">
                <SelectValue placeholder="Custom" />
              </SelectTrigger>
              <SelectContent>
                {(presets.data ?? []).map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-cron">Cron</Label>
            <Input
              id="schedule-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
            />
            {/* The reading is checked while they type, not on submit — a
                refusal discovered after the fact is a wasted round trip. */}
            <p className="text-xs text-muted-foreground">
              {reading ?? "Not a valid schedule"}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="schedule-emails">Email recipients</Label>
          <Textarea
            id="schedule-emails"
            rows={2}
            value={emails}
            placeholder="head@school.test, accounts@school.test"
            onChange={(e) => setEmails(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. A schedule with nobody to send to is refused —
            otherwise the report is generated and nobody is told.
          </p>
        </div>

        <div className="w-40 space-y-1.5">
          <Label htmlFor="schedule-format">Format</Label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as ReportFormat)}
          >
            <SelectTrigger id="schedule-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(selected?.formats ?? ["XLSX"]).map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected && selected.params.length > 0 && (
          <div className="space-y-2 rounded-md border p-4">
            <h3 className="text-sm font-medium">Parameters</h3>
            <ReportParamsForm
              params={selected.params}
              values={values}
              onChange={setValues}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending || (!editing && reportCode === "")}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : editing ? "Save" : "Schedule"}
        </Button>
      </DialogFooter>
    </>
  );
}
