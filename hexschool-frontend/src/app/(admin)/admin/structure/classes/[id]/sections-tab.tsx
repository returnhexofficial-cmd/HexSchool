"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi, timeOf, type Section } from "@/lib/api/structure";
import { sectionSchema, type SectionValues } from "@/lib/validations/structure";
import { FieldError } from "../../master-crud";

const NONE = "__none__";

/** Sections of one class in the selected session (add/edit/delete). */
export function SectionsTab({
  classId,
  classLevel,
  sessionId,
}: {
  classId: string;
  classLevel: number;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Section | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Section | null>(null);

  const sections = useQuery({
    queryKey: ["sections", { classId, sessionId }],
    queryFn: () =>
      structureApi.sections.list({ classId, sessionId, limit: 100 }),
  });
  const shifts = useQuery({
    queryKey: ["shifts", "all"],
    queryFn: () => structureApi.shifts.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const groups = useQuery({
    queryKey: ["groups", "all"],
    queryFn: () => structureApi.groups.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const applicableGroups = (groups.data?.data ?? []).filter(
    (g) => g.applicableFromLevel <= classLevel,
  );

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["sections"] });

  const form = useForm<SectionValues>({
    resolver: zodResolver(sectionSchema),
    defaultValues: { name: "", shiftId: "", groupId: "", capacity: "", roomNo: "" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", shiftId: "", groupId: "", capacity: "", roomNo: "" });
    setDialogOpen(true);
  };
  const openEdit = (section: Section) => {
    setEditing(section);
    form.reset({
      name: section.name,
      shiftId: section.shiftId ?? "",
      groupId: section.groupId ?? "",
      capacity: section.capacity ? String(section.capacity) : "",
      roomNo: section.roomNo ?? "",
    });
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: (values: SectionValues) => {
      const payload = {
        name: values.name,
        capacity: values.capacity ? Number(values.capacity) : undefined,
        roomNo: values.roomNo || undefined,
      };
      return editing
        ? structureApi.sections.update(editing.id, {
            ...payload,
            shiftId: values.shiftId || null,
            groupId: values.groupId || null,
          })
        : structureApi.sections.create({
            classId,
            sessionId,
            ...payload,
            shiftId: values.shiftId || undefined,
            groupId: values.groupId || undefined,
          });
    },
    onSuccess: () => {
      toast.success(editing ? "Section saved" : "Section created");
      if (!editing) {
        // Mid-session additions are allowed — routines/seat plans must be
        // regenerated manually once M13/M14 exist (roadmap M06 §8).
        toast.info("Remember: routines/seat plans must be updated separately.");
      }
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => structureApi.sections.remove(id),
    onSuccess: () => {
      toast.success("Section deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (sections.isPending) return <LoadingBlock />;
  if (sections.isError) {
    return (
      <ErrorState
        error={sections.error}
        onRetry={() => void sections.refetch()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Can permission="section.manage">
        <div className="flex justify-end">
          <Button onClick={openCreate}>New section</Button>
        </div>
      </Can>

      {sections.data.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No sections in this session yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Shift</th>
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium">Capacity</th>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sections.data.data.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2">{s.shift?.name ?? "—"}</td>
                  <td className="px-3 py-2">{s.group?.name ?? "—"}</td>
                  <td className="px-3 py-2">{s.capacity ?? "—"}</td>
                  <td className="px-3 py-2">{s.roomNo ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Can permission="section.manage">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(s)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit section ${editing.name}` : "New section"}
        form={form}
        onSubmit={(values) => save.mutate(values)}
        submitLabel={editing ? "Save" : "Create"}
        isPending={save.isPending}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="section-name">Name</Label>
            <Input id="section-name" placeholder="A" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="section-capacity">Capacity (advisory)</Label>
            <Input id="section-capacity" placeholder="40" {...form.register("capacity")} />
            <FieldError message={form.formState.errors.capacity?.message} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Shift</Label>
            <Select
              value={form.watch("shiftId") || NONE}
              onValueChange={(v) => form.setValue("shiftId", v === NONE ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {(shifts.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({timeOf(s.startTime)}–{timeOf(s.endTime)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Group</Label>
            <Select
              value={form.watch("groupId") || NONE}
              onValueChange={(v) => form.setValue("groupId", v === NONE ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {applicableGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only groups applicable to level {classLevel} are listed.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="section-room">Room (optional)</Label>
          <Input id="section-room" placeholder="204" {...form.register("roomNo")} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete section "${deleteTarget?.name}"?`}
        description="Soft-deletes the section. Enrollment guards arrive with Module 11."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
