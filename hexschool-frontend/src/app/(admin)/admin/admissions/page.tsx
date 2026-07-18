"use client";

import { useState } from "react";
import Link from "next/link";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  admissionCyclesApi,
  type AdmissionCycle,
  type AdmissionCycleStatus,
  type CycleInput,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { CYCLE_STATUSES } from "@/lib/validations/admission";
import { CycleFormDialog } from "./cycle-form-dialog";

const ALL = "__all__";

const STATUS_VARIANT: Record<
  AdmissionCycleStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "secondary",
  OPEN: "default",
  CLOSED: "outline",
  COMPLETED: "outline",
};

export default function AdmissionCyclesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AdmissionCycleStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const query = useQuery({
    queryKey: [
      "admission-cycles",
      { page, limit, search: debouncedSearch, status },
    ],
    queryFn: () =>
      admissionCyclesApi.list({
        page,
        limit,
        search: debouncedSearch,
        status: status || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (input: CycleInput) => admissionCyclesApi.create(input),
    onSuccess: (cycle) => {
      toast.success(`Cycle "${cycle.name}" created (draft).`);
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admission-cycles"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<AdmissionCycle>[] = [
    {
      id: "name",
      header: "Cycle",
      cell: ({ row }) => (
        <Link
          href={`/admin/admissions/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "session",
      header: "Session",
      cell: ({ row }) => row.original.session.name,
    },
    {
      id: "window",
      header: "Application Window",
      cell: ({ row }) =>
        `${row.original.startAt.slice(0, 10)} → ${row.original.endAt.slice(0, 10)}`,
    },
    {
      id: "classes",
      header: "Classes / Seats",
      cell: ({ row }) =>
        row.original.classes
          .map((c) => `${c.class.name} (${c.seats})`)
          .join(", ") || "—",
    },
    {
      id: "test",
      header: "Test",
      cell: ({ row }) => (row.original.testRequired ? "Required" : "No test"),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {row.original.status}
        </Badge>
      ),
    },
  ];

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Admissions"
        description="Admission cycles, applications, tests, and merit lists"
      >
        <Can permission="admission.cycle.manage">
          <Button onClick={() => setCreateOpen(true)}>New cycle</Button>
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
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Cycle name…"
        exportFileName="admission-cycles"
        emptyTitle="No admission cycles yet"
        emptyDescription="Create a cycle, add classes with seats and fees, then open it for applications."
        toolbar={
          <Select
            value={status || ALL}
            onValueChange={(v) => {
              setStatus((v === ALL ? "" : v) as AdmissionCycleStatus | "");
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {CYCLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <CycleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(input) => create.mutate(input)}
        isPending={create.isPending}
      />
    </main>
  );
}
