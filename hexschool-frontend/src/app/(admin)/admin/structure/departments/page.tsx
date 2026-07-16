"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { structureApi, type Department } from "@/lib/api/structure";
import {
  departmentSchema,
  type DepartmentValues,
} from "@/lib/validations/structure";
import { FieldError, MasterCrud } from "../master-crud";

export default function DepartmentsPage() {
  return (
    <MasterCrud<Department, DepartmentValues>
      entityLabel="Department"
      queryKey="departments"
      managePermission="department.manage"
      list={(q) => structureApi.departments.list(q)}
      create={(v) => structureApi.departments.create(v)}
      update={(id, v) => structureApi.departments.update(id, v)}
      remove={(id) => structureApi.departments.remove(id)}
      schema={departmentSchema}
      defaults={{ name: "", code: "" }}
      toFormValues={(row) => ({ name: row.name, code: row.code })}
      defaultSort="name:asc"
      deleteHint="Blocked while subjects still belong to this department."
      columns={[
        { accessorKey: "name", header: "Name", enableSorting: true },
        { accessorKey: "code", header: "Code", enableSorting: true },
      ]}
      fields={(form) => (
        <>
          <div className="space-y-2">
            <Label htmlFor="dept-name">Name</Label>
            <Input id="dept-name" placeholder="Science" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dept-code">Code</Label>
            <Input id="dept-code" placeholder="SCI" {...form.register("code")} />
            <FieldError message={form.formState.errors.code?.message} />
          </div>
        </>
      )}
    />
  );
}
