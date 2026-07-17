"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
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
import type { StaffStatus } from "@/lib/api/staff";
import {
  TEACHER_DESIGNATION_LABELS,
  teachersApi,
  type Teacher,
  type TeacherDesignation,
} from "@/lib/api/teachers";
import { structureApi } from "@/lib/api/structure";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { TEACHER_DESIGNATIONS } from "@/lib/validations/teacher";

const ALL = "__all__";

const STATUS_VARIANT: Record<
  StaffStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "default",
  ON_LEAVE: "secondary",
  RESIGNED: "outline",
  TERMINATED: "destructive",
  RETIRED: "outline",
};

export default function TeachersListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>("employeeId:asc");
  const [search, setSearch] = useState("");
  const [designation, setDesignation] = useState<TeacherDesignation | "">("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState<StaffStatus | "">("");
  const [subjectId, setSubjectId] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const query = useQuery({
    queryKey: [
      "teachers",
      {
        page,
        limit,
        sort,
        search: debouncedSearch,
        designation,
        departmentId,
        status,
        subjectId,
      },
    ],
    queryFn: () =>
      teachersApi.list({
        page,
        limit,
        sort,
        search: debouncedSearch,
        designation: designation || undefined,
        departmentId: departmentId || undefined,
        status: status || undefined,
        subjectId: subjectId || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const departments = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => structureApi.departments.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const subjects = useQuery({
    queryKey: ["subjects", "all"],
    queryFn: () => structureApi.subjects.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const columns: ColumnDef<Teacher>[] = [
    { accessorKey: "employeeId", header: "Employee ID", enableSorting: true },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          href={`/admin/teachers/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.firstName} {row.original.lastName}
        </Link>
      ),
    },
    {
      id: "designation",
      header: "Designation",
      cell: ({ row }) => TEACHER_DESIGNATION_LABELS[row.original.designation],
    },
    {
      id: "subjects",
      header: "Expertise",
      cell: ({ row }) =>
        row.original.subjects.map((s) => s.subject.code).join(", ") || "—",
    },
    {
      id: "contact",
      header: "Contact",
      cell: ({ row }) =>
        row.original.user.phone ?? row.original.user.email ?? "—",
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

  const filterSelect = <T extends string>(
    value: T | "",
    onChange: (v: T | "") => void,
    placeholder: string,
    items: Array<{ value: string; label: string }>,
  ) => (
    <Select
      value={value || ALL}
      onValueChange={(v) => {
        onChange((v === ALL ? "" : v) as T | "");
        setPage(1);
      }}
    >
      <SelectTrigger size="sm" className="w-40">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Teachers"
        description="Teaching staff, expertise, and who teaches what where"
      >
        <Can permission="teacher.assign">
          <Button
            variant="outline"
            onClick={() => router.push("/admin/teachers/assignments")}
          >
            Assignment matrix
          </Button>
        </Can>
        <Can permission="teacher.view">
          <Button
            variant="outline"
            onClick={() => router.push("/admin/teachers/leaves")}
          >
            Leaves
          </Button>
        </Can>
        <Can permission="teacher.create">
          <Button onClick={() => router.push("/admin/teachers/new")}>
            New teacher
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
        searchPlaceholder="Name, employee ID, phone, specialization…"
        exportFileName="teachers"
        emptyTitle="No teachers yet"
        toolbar={
          <>
            {filterSelect(
              designation,
              setDesignation,
              "All designations",
              TEACHER_DESIGNATIONS.map((d) => ({
                value: d,
                label: TEACHER_DESIGNATION_LABELS[d],
              })),
            )}
            {filterSelect(
              departmentId,
              setDepartmentId,
              "All departments",
              (departments.data?.data ?? []).map((d) => ({
                value: d.id,
                label: d.name,
              })),
            )}
            {filterSelect(
              subjectId,
              setSubjectId,
              "Any expertise",
              (subjects.data?.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              })),
            )}
            {filterSelect(
              status,
              setStatus,
              "All statuses",
              ["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED", "RETIRED"].map(
                (s) => ({ value: s, label: s }),
              ),
            )}
          </>
        }
      />
    </main>
  );
}
