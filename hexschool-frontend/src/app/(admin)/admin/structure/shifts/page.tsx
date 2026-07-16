"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { structureApi, timeOf, type Shift } from "@/lib/api/structure";
import { shiftSchema, type ShiftValues } from "@/lib/validations/structure";
import { FieldError, MasterCrud } from "../master-crud";

export default function ShiftsPage() {
  return (
    <MasterCrud<Shift, ShiftValues>
      entityLabel="Shift"
      queryKey="shifts"
      managePermission="shift.manage"
      list={(q) => structureApi.shifts.list(q)}
      create={(v) => structureApi.shifts.create(v)}
      update={(id, v) => structureApi.shifts.update(id, v)}
      remove={(id) => structureApi.shifts.remove(id)}
      schema={shiftSchema}
      defaults={{ name: "", startTime: "08:00", endTime: "13:00" }}
      toFormValues={(row) => ({
        name: row.name,
        startTime: timeOf(row.startTime),
        endTime: timeOf(row.endTime),
      })}
      defaultSort="name:asc"
      deleteHint="Blocked while sections still use this shift."
      columns={[
        { accessorKey: "name", header: "Name", enableSorting: true },
        {
          accessorKey: "startTime",
          header: "Starts",
          cell: ({ row }) => timeOf(row.original.startTime),
        },
        {
          accessorKey: "endTime",
          header: "Ends",
          cell: ({ row }) => timeOf(row.original.endTime),
        },
      ]}
      fields={(form) => (
        <>
          <div className="space-y-2">
            <Label htmlFor="shift-name">Name</Label>
            <Input id="shift-name" placeholder="Morning" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="shift-start">Starts</Label>
              <Input id="shift-start" type="time" {...form.register("startTime")} />
              <FieldError message={form.formState.errors.startTime?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift-end">Ends</Label>
              <Input id="shift-end" type="time" {...form.register("endTime")} />
              <FieldError message={form.formState.errors.endTime?.message} />
            </div>
          </div>
        </>
      )}
    />
  );
}
