"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { DataTable } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
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
import {
  GUARDIAN_RELATION_LABELS,
  guardiansApi,
  type Guardian,
  type GuardianRelation,
} from "@/lib/api/students";
import { useDebounce } from "@/lib/hooks/use-debounce";
import {
  GUARDIAN_RELATIONS,
  guardianSchema,
  type GuardianValues,
} from "@/lib/validations/student";

export default function GuardiansListPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>("name:asc");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const query = useQuery({
    queryKey: ["guardians", { page, limit, sort, search: debouncedSearch }],
    queryFn: () =>
      guardiansApi.list({ page, limit, sort, search: debouncedSearch }),
    placeholderData: keepPreviousData,
  });

  const form = useForm<GuardianValues>({
    resolver: zodResolver(guardianSchema),
    defaultValues: {
      name: "",
      nameBn: "",
      relation: "FATHER",
      phone: "",
      email: "",
      nid: "",
      occupation: "",
      monthlyIncome: "",
      presentAddress: "",
    },
  });

  const create = useMutation({
    mutationFn: (values: GuardianValues) =>
      guardiansApi.create({
        name: values.name,
        nameBn: values.nameBn || undefined,
        relation: values.relation,
        phone: values.phone,
        email: values.email || undefined,
        nid: values.nid || undefined,
        occupation: values.occupation || undefined,
        monthlyIncome: values.monthlyIncome
          ? Number(values.monthlyIncome)
          : undefined,
        address: values.presentAddress
          ? { present: values.presentAddress }
          : undefined,
      }),
    onSuccess: () => {
      toast.success("Guardian created");
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["guardians"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<Guardian>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          href={`/admin/guardians/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "phone", header: "Phone", enableSorting: true },
    {
      id: "relation",
      header: "Relation",
      cell: ({ row }) => GUARDIAN_RELATION_LABELS[row.original.relation],
    },
    {
      id: "children",
      header: "Children",
      cell: ({ row }) => row.original.students.length,
    },
    {
      id: "occupation",
      header: "Occupation",
      cell: ({ row }) => row.original.occupation ?? "—",
    },
  ];

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Guardians"
        description="Parent/guardian records — shared across siblings"
      >
        <Can permission="guardian.manage">
          <Button
            onClick={() => {
              form.reset();
              setCreateOpen(true);
            }}
          >
            New guardian
          </Button>
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
        searchPlaceholder="Name, phone, NID…"
        exportFileName="guardians"
        emptyTitle="No guardians yet"
      />

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New guardian"
        description="Phone is the dedup key — a number already on file is rejected (link the existing guardian to the student instead)."
        form={form}
        onSubmit={(values) => create.mutate(values)}
        submitLabel="Create"
        isPending={create.isPending}
      >
        <GuardianFields form={form} />
      </FormDialog>
    </main>
  );
}

export function GuardianFields({
  form,
}: {
  form: ReturnType<typeof useForm<GuardianValues>>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input {...form.register("name")} />
        {form.formState.errors.name?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.name.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Name (Bangla)</Label>
        <Input {...form.register("nameBn")} />
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input {...form.register("phone")} placeholder="01XXXXXXXXX" />
        {form.formState.errors.phone?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.phone.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Relation</Label>
        <Select
          value={form.watch("relation")}
          onValueChange={(v) =>
            form.setValue("relation", v as GuardianRelation)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUARDIAN_RELATIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {GUARDIAN_RELATION_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input {...form.register("email")} />
        {form.formState.errors.email?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>NID</Label>
        <Input {...form.register("nid")} />
        {form.formState.errors.nid?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.nid.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Occupation</Label>
        <Input {...form.register("occupation")} />
      </div>
      <div className="space-y-2">
        <Label>Monthly income (BDT)</Label>
        <Input {...form.register("monthlyIncome")} />
        {form.formState.errors.monthlyIncome?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.monthlyIncome.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Address</Label>
        <Input {...form.register("presentAddress")} />
      </div>
    </div>
  );
}
