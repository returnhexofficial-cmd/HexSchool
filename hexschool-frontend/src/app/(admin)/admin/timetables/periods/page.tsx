"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi, timeOf } from "@/lib/api/structure";
import { periodSlotApi, type PeriodSlot } from "@/lib/api/timetable";
import {
  PERIOD_SLOT_TYPES,
  PERIOD_SLOT_TYPE_LABELS,
  periodSlotSchema,
  type PeriodSlotValues,
} from "@/lib/validations/timetable";

const TYPE_STYLES: Record<string, string> = {
  CLASS: "",
  BREAK: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ASSEMBLY: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

/**
 * The bell schedule editor. Slots belong to a SHIFT rather than a
 * section, so this page is shift-first: pick the shift, then lay out its
 * day. Overlap and shift-bounds rules are enforced server-side; the
 * messages come straight back into the form.
 */
export default function PeriodSlotsPage() {
  const qc = useQueryClient();
  const [shiftId, setShiftId] = useState("");
  const [editing, setEditing] = useState<PeriodSlot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<PeriodSlot | null>(null);

  const shifts = useQuery({
    queryKey: ["shifts", "all"],
    queryFn: () => structureApi.shifts.list({ limit: 100 }),
    staleTime: 60_000,
  });

  // The first shift is almost always the one being edited — selecting it
  // during render avoids an effect that would re-render the whole grid.
  const shiftList = shifts.data?.data ?? [];
  const activeShiftId = shiftId || shiftList[0]?.id || "";

  const slots = useQuery({
    queryKey: ["period-slots", activeShiftId],
    queryFn: () => periodSlotApi.list(activeShiftId),
    enabled: !!activeShiftId,
  });

  const form = useForm<PeriodSlotValues>({
    resolver: zodResolver(periodSlotSchema),
    defaultValues: {
      shiftId: activeShiftId,
      name: "",
      startTime: "08:00",
      endTime: "08:45",
      type: "CLASS",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      shiftId: activeShiftId,
      name: "",
      startTime: lastEnd() ?? "08:00",
      endTime: "",
      type: "CLASS",
    });
    setDialogOpen(true);
  };

  const openEdit = (slot: PeriodSlot) => {
    setEditing(slot);
    form.reset({
      shiftId: slot.shiftId,
      name: slot.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      type: slot.type,
    });
    setDialogOpen(true);
  };

  /** New periods usually start where the last one ended. */
  const lastEnd = (): string | null => {
    const rows = slots.data ?? [];
    return rows.length > 0 ? rows[rows.length - 1].endTime : null;
  };

  const save = useMutation({
    mutationFn: (values: PeriodSlotValues) =>
      editing
        ? periodSlotApi.update(editing.id, {
            name: values.name,
            startTime: values.startTime,
            endTime: values.endTime,
            type: values.type,
          })
        : periodSlotApi.create(values),
    onSuccess: () => {
      toast.success(editing ? "Period updated." : "Period added.");
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ["period-slots"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => periodSlotApi.remove(id),
    onSuccess: () => {
      toast.success("Period retired.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["period-slots"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const shift = shiftList.find((s) => s.id === activeShiftId);

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Period slots"
        description="The bell schedule each shift runs on. Routines and period attendance are built from these."
      >
        <Button variant="outline" asChild>
          <Link href="/admin/timetables">Routines</Link>
        </Button>
        <Can permission="period.slot.manage">
          <Button onClick={openCreate} disabled={!activeShiftId}>
            Add period
          </Button>
        </Can>
      </PageHeader>

      {shifts.isPending ? (
        <LoadingBlock />
      ) : shiftList.length === 0 ? (
        <EmptyState
          title="No shifts defined"
          description="Create a shift under Academic Structure first — periods belong to a shift's working window."
          action={
            <Button variant="outline" asChild>
              <Link href="/admin/structure/shifts">Go to shifts</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56 space-y-1">
              <Label>Shift</Label>
              <Select value={activeShiftId} onValueChange={setShiftId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {shiftList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {shift ? (
              <p className="pb-2 text-sm text-muted-foreground">
                Working window {timeOf(shift.startTime)}–{timeOf(shift.endTime)}
                . Periods must sit inside it and may not overlap.
              </p>
            ) : null}
          </div>

          {slots.isPending ? (
            <LoadingBlock />
          ) : slots.isError ? (
            <ErrorState onRetry={() => void slots.refetch()} />
          ) : (slots.data ?? []).length === 0 ? (
            <EmptyState
              title="No periods yet"
              description="Add the first period of the day — routines cannot be built without a bell schedule."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(slots.data ?? []).map((slot) => (
                    <TableRow key={slot.id} className={TYPE_STYLES[slot.type]}>
                      <TableCell className="font-medium">
                        {slot.displayOrder}
                      </TableCell>
                      <TableCell>{slot.name}</TableCell>
                      <TableCell>{slot.startTime}</TableCell>
                      <TableCell>{slot.endTime}</TableCell>
                      <TableCell>
                        {slot.endMinutes - slot.startMinutes} min
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            slot.type === "CLASS" ? "default" : "secondary"
                          }
                        >
                          {PERIOD_SLOT_TYPE_LABELS[slot.type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Can permission="period.slot.manage">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(slot)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleting(slot)}
                          >
                            Delete
                          </Button>
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${editing.name}` : "Add a period"}
        description="Times are 24-hour and must sit inside the shift window without overlapping another period."
        form={form}
        isPending={save.isPending}
        onSubmit={(values) => save.mutate(values)}
      >
        <div className="space-y-1">
          <Label htmlFor="slot-name">Name</Label>
          <Input
            id="slot-name"
            placeholder="Period 1"
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="slot-start">Start</Label>
            <Input id="slot-start" type="time" {...form.register("startTime")} />
            {form.formState.errors.startTime ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.startTime.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="slot-end">End</Label>
            <Input id="slot-end" type="time" {...form.register("endTime")} />
            {form.formState.errors.endTime ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.endTime.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={form.watch("type")}
            onValueChange={(v) =>
              form.setValue("type", v as PeriodSlotValues["type"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_SLOT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {PERIOD_SLOT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only <strong>Class</strong> periods can hold a lesson. Breaks and
            assembly still print on the routine.
          </p>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Retire ${deleting?.name ?? "this period"}?`}
        description="Refused if any routine cell or attendance record still uses it."
        confirmLabel="Retire"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </main>
  );
}
