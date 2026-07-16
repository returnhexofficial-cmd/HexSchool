"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
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
import { academicApi, type AcademicSession } from "@/lib/api/academic";
import { apiErrorMessage } from "@/lib/api/auth";
import { sessionSchema, type SessionValues } from "@/lib/validations/academic";

const STATUS_BADGE: Record<
  AcademicSession["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  UPCOMING: "outline",
  ACTIVE: "default",
  COMPLETED: "secondary",
  ARCHIVED: "secondary",
};

const dateCell = (iso: string) => iso.slice(0, 10);

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>("startDate:desc");

  const [editing, setEditing] = useState<AcademicSession | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activateTarget, setActivateTarget] = useState<AcademicSession | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<AcademicSession | null>(
    null,
  );

  const query = useQuery({
    queryKey: ["academic-sessions", { page, limit, sort }],
    queryFn: () => academicApi.listSessions({ page, limit, sort }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["academic-sessions"] });

  const form = useForm<SessionValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: { name: "", startDate: "", endDate: "" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", startDate: "", endDate: "" });
    setDialogOpen(true);
  };
  const openEdit = (session: AcademicSession) => {
    setEditing(session);
    form.reset({
      name: session.name,
      startDate: dateCell(session.startDate),
      endDate: dateCell(session.endDate),
    });
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: (values: SessionValues) =>
      editing
        ? academicApi.updateSession(editing.id, values)
        : academicApi.createSession(values),
    onSuccess: () => {
      toast.success(editing ? "Session saved" : "Session created");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const activate = useMutation({
    mutationFn: (id: string) => academicApi.activateSession(id),
    onSuccess: (session) => {
      toast.success(`"${session.name}" is now the current session`);
      setActivateTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => academicApi.deleteSession(id),
    onSuccess: () => {
      toast.success("Session deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<AcademicSession>[] = [
    {
      accessorKey: "name",
      header: "Session",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 font-medium">
          {row.original.name}
          {row.original.isCurrent ? (
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: "startDate",
      header: "Starts",
      enableSorting: true,
      cell: ({ row }) => dateCell(row.original.startDate),
    },
    {
      accessorKey: "endDate",
      header: "Ends",
      enableSorting: true,
      cell: ({ row }) => dateCell(row.original.endDate),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE[row.original.status]}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {!row.original.isCurrent ? (
            <Can permission="session.activate">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActivateTarget(row.original)}
              >
                Make current
              </Button>
            </Can>
          ) : null}
          <Can permission="session.update">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(row.original)}
            >
              Edit
            </Button>
          </Can>
          {!row.original.isCurrent ? (
            <Can permission="session.delete">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                Delete
              </Button>
            </Can>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Academic Sessions"
        description="The temporal backbone — enrollment, attendance, exams, and fees all scope to a session"
      >
        <Can permission="session.create">
          <Button onClick={openCreate}>New session</Button>
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
        emptyTitle="No sessions yet"
        emptyDescription='Create the first academic session (e.g. "2026").'
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit session "${editing.name}"` : "New session"}
        description="Dates must not overlap another session."
        form={form}
        onSubmit={(values) => save.mutate(values)}
        submitLabel={editing ? "Save" : "Create"}
        isPending={save.isPending}
      >
        <div className="space-y-2">
          <Label htmlFor="session-name">Name</Label>
          <Input id="session-name" placeholder="2026" {...form.register("name")} />
          {form.formState.errors.name ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="session-start">Start date</Label>
            <Input
              id="session-start"
              type="date"
              {...form.register("startDate")}
            />
            {form.formState.errors.startDate ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.startDate.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-end">End date</Label>
            <Input id="session-end" type="date" {...form.register("endDate")} />
            {form.formState.errors.endDate ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.endDate.message}
              </p>
            ) : null}
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={activateTarget !== null}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title={`Make "${activateTarget?.name}" the current session?`}
        description="All session-scoped pages (enrollment, attendance, exams, fees) will default to this session. The previously current session is marked COMPLETED and becomes read-only for entry."
        confirmLabel="Make current"
        isPending={activate.isPending}
        onConfirm={() => {
          if (activateTarget) activate.mutate(activateTarget.id);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete session "${deleteTarget?.name}"?`}
        description="Only possible while nothing references it (holidays, events, enrollment…). Otherwise archive it instead."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </main>
  );
}
