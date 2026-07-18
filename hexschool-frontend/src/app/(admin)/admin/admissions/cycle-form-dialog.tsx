"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { FormDialog } from "@/components/shared/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { academicApi } from "@/lib/api/academic";
import type { AdmissionCycle, CycleInput } from "@/lib/api/admissions";
import { structureApi } from "@/lib/api/structure";
import { cycleSchema, type CycleValues } from "@/lib/validations/admission";

interface CycleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode. */
  cycle?: AdmissionCycle;
  onSubmit: (input: CycleInput) => void;
  isPending: boolean;
}

const emptyValues: CycleValues = {
  sessionId: "",
  name: "",
  startAt: "",
  endAt: "",
  testRequired: false,
  instructions: "",
  classes: [{ classId: "", seats: "", applicationFee: "" }],
};

/** Create/edit an admission cycle incl. its per-class seats + fees. */
export function CycleFormDialog({
  open,
  onOpenChange,
  cycle,
  onSubmit,
  isPending,
}: CycleFormDialogProps) {
  const form = useForm<CycleValues>({
    resolver: zodResolver(cycleSchema),
    defaultValues: emptyValues,
  });
  const classRows = useFieldArray({ control: form.control, name: "classes" });

  useEffect(() => {
    if (!open) return;
    form.reset(
      cycle
        ? {
            sessionId: cycle.sessionId,
            name: cycle.name,
            startAt: cycle.startAt.slice(0, 10),
            endAt: cycle.endAt.slice(0, 10),
            testRequired: cycle.testRequired,
            instructions: cycle.instructions ?? "",
            classes: cycle.classes.map((c) => ({
              classId: c.classId,
              seats: String(c.seats),
              applicationFee: String(Number(c.applicationFee)),
            })),
          }
        : emptyValues,
    );
  }, [open, cycle, form]);

  const sessions = useQuery({
    queryKey: ["sessions", "all"],
    queryFn: () => academicApi.listSessions({ limit: 100 }),
    staleTime: 60_000,
  });
  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const submit = (values: CycleValues) => {
    onSubmit({
      sessionId: values.sessionId,
      name: values.name,
      // Window covers the whole start/end days (dates → timestamps).
      startAt: `${values.startAt}T00:00:00.000Z`,
      endAt: `${values.endAt}T23:59:59.999Z`,
      testRequired: values.testRequired,
      instructions: values.instructions || undefined,
      classes: values.classes.map((c) => ({
        classId: c.classId,
        seats: Number(c.seats),
        applicationFee: c.applicationFee ? Number(c.applicationFee) : 0,
      })),
    });
  };

  const err = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={cycle ? "Edit admission cycle" : "New admission cycle"}
      description="Classes carry their own seat count and application fee."
      form={form}
      onSubmit={submit}
      submitLabel={cycle ? "Save changes" : "Create cycle"}
      isPending={isPending}
    >
      <div className="space-y-2">
        <Label>Academic session</Label>
        <Select
          value={form.watch("sessionId")}
          onValueChange={(v) =>
            form.setValue("sessionId", v, { shouldValidate: true })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick the session admission is for" />
          </SelectTrigger>
          <SelectContent>
            {(sessions.data?.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {err.sessionId?.message ? (
          <p className="text-sm text-destructive">{err.sessionId.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cycle-name">Name</Label>
        <Input
          id="cycle-name"
          placeholder="Admission 2027"
          {...form.register("name")}
        />
        {err.name?.message ? (
          <p className="text-sm text-destructive">{err.name.message}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cycle-start">Applications open</Label>
          <Input id="cycle-start" type="date" {...form.register("startAt")} />
          {err.startAt?.message ? (
            <p className="text-sm text-destructive">{err.startAt.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="cycle-end">Applications close</Label>
          <Input id="cycle-end" type="date" {...form.register("endAt")} />
          {err.endAt?.message ? (
            <p className="text-sm text-destructive">{err.endAt.message}</p>
          ) : null}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.watch("testRequired")}
          onCheckedChange={(v) => form.setValue("testRequired", v === true)}
        />
        Admission test required
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Classes, seats &amp; fees (BDT)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              classRows.append({ classId: "", seats: "", applicationFee: "" })
            }
          >
            Add class
          </Button>
        </div>
        {classRows.fields.map((row, i) => (
          <div key={row.id} className="flex items-start gap-2">
            <Select
              value={form.watch(`classes.${i}.classId`)}
              onValueChange={(v) =>
                form.setValue(`classes.${i}.classId`, v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>
                {(classes.data?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="w-20"
              placeholder="Seats"
              {...form.register(`classes.${i}.seats`)}
            />
            <Input
              className="w-24"
              placeholder="Fee"
              {...form.register(`classes.${i}.applicationFee`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={classRows.fields.length === 1}
              onClick={() => classRows.remove(i)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {err.classes?.message || err.classes?.root?.message ? (
          <p className="text-sm text-destructive">
            {err.classes.message ?? err.classes.root?.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cycle-instructions">
          Instructions (shown on the public portal)
        </Label>
        <Textarea
          id="cycle-instructions"
          rows={3}
          placeholder="Eligibility, required documents, contact…"
          {...form.register("instructions")}
        />
      </div>
    </FormDialog>
  );
}
