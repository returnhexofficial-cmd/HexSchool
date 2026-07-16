"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { structureApi, type Group } from "@/lib/api/structure";
import { groupSchema, type GroupValues } from "@/lib/validations/structure";
import { FieldError, MasterCrud } from "../master-crud";

export default function GroupsPage() {
  return (
    <MasterCrud<Group, GroupValues>
      entityLabel="Group"
      queryKey="groups"
      managePermission="group.manage"
      list={(q) => structureApi.groups.list(q)}
      create={(v) =>
        structureApi.groups.create({
          name: v.name,
          applicableFromLevel: Number(v.applicableFromLevel),
        })
      }
      update={(id, v) =>
        structureApi.groups.update(id, {
          name: v.name,
          applicableFromLevel: Number(v.applicableFromLevel),
        })
      }
      remove={(id) => structureApi.groups.remove(id)}
      schema={groupSchema}
      defaults={{ name: "", applicableFromLevel: "9" }}
      toFormValues={(row) => ({
        name: row.name,
        applicableFromLevel: String(row.applicableFromLevel),
      })}
      defaultSort="name:asc"
      deleteHint="Blocked while sections or subject mappings still use this group."
      columns={[
        { accessorKey: "name", header: "Name", enableSorting: true },
        {
          accessorKey: "applicableFromLevel",
          header: "From class level",
          enableSorting: true,
        },
      ]}
      fields={(form) => (
        <>
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" placeholder="Science" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-level">Applies from class level</Label>
            <Input id="group-level" placeholder="9" {...form.register("applicableFromLevel")} />
            <FieldError
              message={form.formState.errors.applicableFromLevel?.message}
            />
            <p className="text-xs text-muted-foreground">
              BD convention: streams start at class 9.
            </p>
          </div>
        </>
      )}
    />
  );
}
