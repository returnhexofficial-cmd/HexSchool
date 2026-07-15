"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { rbacApi, type RoleWithStats } from "@/lib/api/rbac";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { createRoleSchema, type CreateRoleValues } from "@/lib/validations/rbac";

/** Roles list (roadmap M03 §5): DataTable + create dialog + delete. */
export default function RolesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleWithStats | null>(null);

  const query = useQuery({
    queryKey: ["roles", { page, limit, sort, search: debouncedSearch }],
    queryFn: () =>
      rbacApi.listRoles({ page, limit, sort, search: debouncedSearch }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["roles"] });

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const createRole = useMutation({
    mutationFn: (values: CreateRoleValues) =>
      rbacApi.createRole({
        name: values.name,
        slug: values.slug,
        description: values.description || undefined,
      }),
    onSuccess: (role) => {
      toast.success(`Role "${role.name}" created`);
      setCreateOpen(false);
      form.reset();
      void invalidate();
      router.push(`/admin/roles/${role.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteRole = useMutation({
    mutationFn: (id: string) => rbacApi.deleteRole(id),
    onSuccess: () => {
      toast.success("Role deleted");
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<RoleWithStats>[] = [
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          href={`/admin/roles/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "slug", header: "Slug", enableSorting: true },
    {
      accessorKey: "isSystem",
      header: "Type",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.isSystem ? (
          <Badge variant="secondary">System</Badge>
        ) : (
          <Badge variant="outline">Custom</Badge>
        ),
    },
    { accessorKey: "permissionCount", header: "Permissions" },
    { accessorKey: "userCount", header: "Users" },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      enableSorting: true,
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleDateString("en-GB", {
          timeZone: "Asia/Dhaka",
        }),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.isSystem ? null : (
          <Can permission="role.delete">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteTarget(row.original)}
            >
              Delete
            </Button>
          </Can>
        ),
    },
  ];

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Roles & Permissions"
        description="Roles group permissions; users get roles. System roles are locked."
      >
        <Can permission="role.create">
          <Button onClick={() => setCreateOpen(true)}>New role</Button>
        </Can>
      </PageHeader>

      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search roles…"
        exportFileName="roles"
        emptyTitle="No roles found"
      />

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New role"
        description="Custom role for this school. Slug is permanent."
        form={form}
        onSubmit={(values) => createRole.mutate(values)}
        submitLabel="Create role"
        isPending={createRole.isPending}
      >
        <div className="space-y-2">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            placeholder="Exam Controller"
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="role-slug">Slug</Label>
          <Input
            id="role-slug"
            placeholder="exam-controller"
            {...form.register("slug")}
          />
          {form.formState.errors.slug ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.slug.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="role-description">Description (optional)</Label>
          <Input id="role-description" {...form.register("description")} />
          {form.formState.errors.description ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.description.message}
            </p>
          ) : null}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete role "${deleteTarget?.name}"?`}
        description={
          deleteTarget?.userCount
            ? `${deleteTarget.userCount} user(s) still hold this role — the API will refuse until they are reassigned.`
            : "This soft-deletes the role. Its slug becomes available again."
        }
        confirmLabel="Delete"
        destructive
        isPending={deleteRole.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteRole.mutate(deleteTarget.id);
        }}
      />
    </main>
  );
}
