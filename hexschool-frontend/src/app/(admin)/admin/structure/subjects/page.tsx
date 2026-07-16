"use client";

import { useQuery } from "@tanstack/react-query";
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
  structureApi,
  type Subject,
  type SubjectType,
} from "@/lib/api/structure";
import { subjectSchema, type SubjectValues } from "@/lib/validations/structure";
import { FieldError, MasterCrud } from "../master-crud";

const NONE = "__none__";

export default function SubjectsPage() {
  const departments = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => structureApi.departments.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const deptName = (id: string | null) =>
    departments.data?.data.find((d) => d.id === id)?.name ?? "—";

  return (
    <MasterCrud<Subject, SubjectValues>
      entityLabel="Subject"
      queryKey="subjects"
      managePermission="subject.manage"
      list={(q) => structureApi.subjects.list(q)}
      create={(v) =>
        structureApi.subjects.create({
          name: v.name,
          nameBn: v.nameBn || undefined,
          code: v.code,
          departmentId: v.departmentId || undefined,
          type: v.type,
        })
      }
      update={(id, v) =>
        structureApi.subjects.update(id, {
          name: v.name,
          nameBn: v.nameBn || undefined,
          code: v.code,
          departmentId: v.departmentId || undefined,
          type: v.type,
        })
      }
      remove={(id) => structureApi.subjects.remove(id)}
      schema={subjectSchema}
      defaults={{ name: "", nameBn: "", code: "", departmentId: "", type: "THEORY" }}
      toFormValues={(row) => ({
        name: row.name,
        nameBn: row.nameBn ?? "",
        code: row.code,
        departmentId: row.departmentId ?? "",
        type: row.type,
      })}
      defaultSort="name:asc"
      deleteHint="Blocked while the subject is mapped to any class-session."
      columns={[
        { accessorKey: "name", header: "Name", enableSorting: true },
        { accessorKey: "code", header: "Code", enableSorting: true },
        { accessorKey: "type", header: "Type", enableSorting: true },
        {
          accessorKey: "departmentId",
          header: "Department",
          cell: ({ row }) => deptName(row.original.departmentId),
        },
      ]}
      fields={(form) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="subject-name">Name</Label>
              <Input id="subject-name" placeholder="Physics" {...form.register("name")} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-name-bn">Name (Bangla)</Label>
              <Input id="subject-name-bn" {...form.register("nameBn")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="subject-code">Code</Label>
              <Input id="subject-code" placeholder="PHY" {...form.register("code")} />
              <FieldError message={form.formState.errors.code?.message} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) => form.setValue("type", v as SubjectType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["THEORY", "PRACTICAL", "BOTH"] as const).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Department (optional)</Label>
            <Select
              value={form.watch("departmentId") || NONE}
              onValueChange={(v) =>
                form.setValue("departmentId", v === NONE ? "" : v)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {(departments.data?.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    />
  );
}
