"use client";

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { structureApi, type SchoolClass } from "@/lib/api/structure";
import { classSchema, type ClassValues } from "@/lib/validations/structure";
import { FieldError, MasterCrud } from "../master-crud";

export default function ClassesPage() {
  return (
    <MasterCrud<SchoolClass, ClassValues>
      entityLabel="Class"
      queryKey="classes"
      managePermission="class.manage"
      list={(q) => structureApi.classes.list(q)}
      create={(v) =>
        structureApi.classes.create({
          name: v.name,
          nameBn: v.nameBn || undefined,
          numericLevel: Number(v.numericLevel),
          displayOrder: v.displayOrder ? Number(v.displayOrder) : undefined,
        })
      }
      update={(id, v) =>
        structureApi.classes.update(id, {
          name: v.name,
          nameBn: v.nameBn || undefined,
          numericLevel: Number(v.numericLevel),
          displayOrder: v.displayOrder ? Number(v.displayOrder) : undefined,
        })
      }
      remove={(id) => structureApi.classes.remove(id)}
      schema={classSchema}
      defaults={{ name: "", nameBn: "", numericLevel: "", displayOrder: "" }}
      toFormValues={(row) => ({
        name: row.name,
        nameBn: row.nameBn ?? "",
        numericLevel: String(row.numericLevel),
        displayOrder: String(row.displayOrder),
      })}
      defaultSort="numericLevel:asc"
      deleteHint="Blocked while the class has sections or subject mappings."
      columns={[
        {
          accessorKey: "name",
          header: "Name",
          enableSorting: true,
          cell: ({ row }) => (
            <Link
              href={`/admin/structure/classes/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
          ),
        },
        { accessorKey: "numericLevel", header: "Level", enableSorting: true },
        {
          accessorKey: "nameBn",
          header: "Name (Bangla)",
          cell: ({ row }) => row.original.nameBn ?? "—",
        },
      ]}
      fields={(form) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="class-name">Name</Label>
              <Input id="class-name" placeholder="Class 6" {...form.register("name")} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="class-name-bn">Name (Bangla)</Label>
              <Input id="class-name-bn" {...form.register("nameBn")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="class-level">Numeric level</Label>
              <Input id="class-level" placeholder="6" {...form.register("numericLevel")} />
              <FieldError message={form.formState.errors.numericLevel?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="class-order">Display order (optional)</Label>
              <Input id="class-order" {...form.register("displayOrder")} />
            </div>
          </div>
        </>
      )}
    />
  );
}
