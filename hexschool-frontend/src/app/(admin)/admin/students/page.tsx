"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
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
import { apiErrorMessage } from "@/lib/api/auth";
import type { Gender } from "@/lib/api/staff";
import {
  GUARDIAN_RELATION_LABELS,
  studentsApi,
  type Student,
  type StudentStatus,
} from "@/lib/api/students";
import { structureApi } from "@/lib/api/structure";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { STUDENT_STATUSES } from "@/lib/validations/student";

const ALL = "__all__";

const STATUS_VARIANT: Record<
  StudentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  TRANSFERRED: "outline",
  GRADUATED: "outline",
  DROPPED: "destructive",
  SUSPENDED: "destructive",
};

export default function StudentsListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>("studentUid:asc");
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState<StudentStatus | "">("");
  const [gender, setGender] = useState<Gender | "">("");
  const debouncedSearch = useDebounce(search, 300);

  const query = useQuery({
    queryKey: [
      "students",
      { page, limit, sort, search: debouncedSearch, classId, status, gender },
    ],
    queryFn: () =>
      studentsApi.list({
        page,
        limit,
        sort,
        search: debouncedSearch,
        classId: classId || undefined,
        status: status || undefined,
        gender: gender || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const batchIdCards = useMutation({
    mutationFn: (ids: string[]) => studentsApi.downloadIdCards(ids),
    onSuccess: (incomplete) => {
      toast.success(
        incomplete > 0
          ? `ID cards downloaded — ${incomplete} card(s) lack a photo.`
          : "ID cards downloaded.",
      );
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<Student>[] = [
    { accessorKey: "studentUid", header: "Student UID", enableSorting: true },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          href={`/admin/students/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.firstName} {row.original.lastName}
        </Link>
      ),
    },
    {
      id: "class",
      header: "Class",
      cell: ({ row }) => row.original.admissionClass?.name ?? "—",
    },
    { accessorKey: "gender", header: "Gender" },
    { accessorKey: "dob", header: "Date of Birth", enableSorting: true },
    {
      id: "guardian",
      header: "Primary Guardian",
      cell: ({ row }) => {
        const primary = row.original.guardians.find((g) => g.isPrimary);
        return primary
          ? `${primary.guardian.name} (${GUARDIAN_RELATION_LABELS[primary.relation]}) · ${primary.guardian.phone}`
          : "—";
      },
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
        title="Students"
        description="Student master records, guardians, and ID cards"
      >
        <Can permission="student.idcard.generate">
          <Button
            variant="outline"
            disabled={batchIdCards.isPending || !query.data?.data.length}
            onClick={() =>
              batchIdCards.mutate(query.data!.data.map((s) => s.id))
            }
          >
            ID cards (page)
          </Button>
        </Can>
        <Can permission="student.import">
          <Button
            variant="outline"
            onClick={() => router.push("/admin/students/import")}
          >
            Import
          </Button>
        </Can>
        <Can permission="student.create">
          <Button onClick={() => router.push("/admin/students/new")}>
            New student
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
        searchPlaceholder="Name, UID, guardian phone…"
        exportFileName="students"
        emptyTitle="No students yet"
        toolbar={
          <>
            {filterSelect(
              classId,
              setClassId,
              "All classes",
              (classes.data?.data ?? []).map((c) => ({
                value: c.id,
                label: c.name,
              })),
            )}
            {filterSelect(
              gender,
              setGender,
              "All genders",
              ["MALE", "FEMALE", "OTHER"].map((g) => ({ value: g, label: g })),
            )}
            {filterSelect(
              status,
              setStatus,
              "All statuses",
              STUDENT_STATUSES.map((s) => ({ value: s, label: s })),
            )}
          </>
        }
      />
    </main>
  );
}
