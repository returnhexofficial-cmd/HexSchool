"use client";

import { useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
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
import type { PaginationMeta } from "@/lib/api/axios";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  teacherLeavesApi,
  teachersApi,
  type LeaveStatus,
  type TeacherLeave,
} from "@/lib/api/teachers";
import {
  LEAVE_TYPES,
  teacherLeaveSchema,
  type TeacherLeaveValues,
} from "@/lib/validations/teacher";

const STATUS_VARIANT: Record<
  LeaveStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "outline",
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * Shared leave table + record/approve/reject/delete actions — used by
 * the leave inbox page and, teacher-scoped, by the detail Leaves tab.
 */
export function LeavesTable({
  query,
  onPageChange,
  onLimitChange,
  toolbar,
  fixedTeacherId,
  showTeacherColumn = true,
}: {
  query: UseQueryResult<{ data: TeacherLeave[]; meta: PaginationMeta }>;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  toolbar?: React.ReactNode;
  /** When set, the create dialog skips the teacher picker. */
  fixedTeacherId?: string;
  showTeacherColumn?: boolean;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [decideTarget, setDecideTarget] = useState<{
    leave: TeacherLeave;
    action: "approve" | "reject" | "delete";
  } | null>(null);

  const teachers = useQuery({
    queryKey: ["teachers", "active-all"],
    queryFn: () => teachersApi.list({ status: "ACTIVE", limit: 100 }),
    enabled: dialogOpen && !fixedTeacherId,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["teacher-leaves"] });

  const form = useForm<TeacherLeaveValues>({
    resolver: zodResolver(teacherLeaveSchema),
    defaultValues: {
      teacherId: fixedTeacherId ?? "",
      fromDate: "",
      toDate: "",
      type: "CASUAL",
      reason: "",
    },
  });

  const create = useMutation({
    mutationFn: (values: TeacherLeaveValues) =>
      teacherLeavesApi.create({
        teacherId: values.teacherId,
        fromDate: values.fromDate,
        toDate: values.toDate,
        type: values.type,
        reason: values.reason || undefined,
      }),
    onSuccess: () => {
      toast.success("Leave recorded (PENDING)");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const decide = useMutation({
    mutationFn: async ({
      leave,
      action,
    }: {
      leave: TeacherLeave;
      action: "approve" | "reject" | "delete";
    }) => {
      if (action === "approve") await teacherLeavesApi.approve(leave.id);
      else if (action === "reject") await teacherLeavesApi.reject(leave.id);
      else await teacherLeavesApi.remove(leave.id);
    },
    onSuccess: (_, { action }) => {
      toast.success(
        action === "approve"
          ? "Leave approved"
          : action === "reject"
            ? "Leave rejected"
            : "Leave deleted",
      );
      setDecideTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<TeacherLeave>[] = [
    ...(showTeacherColumn
      ? ([
          {
            id: "teacher",
            header: "Teacher",
            cell: ({ row }) =>
              row.original.teacher
                ? `${row.original.teacher.firstName} ${row.original.teacher.lastName} (${row.original.teacher.employeeId})`
                : "—",
          },
        ] as ColumnDef<TeacherLeave>[])
      : []),
    {
      id: "range",
      header: "Dates",
      cell: ({ row }) =>
        `${day(row.original.fromDate)} → ${day(row.original.toDate)}`,
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge>,
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
    {
      id: "reason",
      header: "Reason",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.reason ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const leave = row.original;
        if (leave.status !== "PENDING") return null;
        return (
          <div className="flex justify-end gap-1">
            <Can permission="teacher.leave.approve">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDecideTarget({ leave, action: "approve" })}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDecideTarget({ leave, action: "reject" })}
              >
                Reject
              </Button>
            </Can>
            <Can permission="teacher.leave.manage">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setDecideTarget({ leave, action: "delete" })}
              >
                Delete
              </Button>
            </Can>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <Can permission="teacher.leave.manage">
        <div className="flex justify-end">
          <Button
            onClick={() => {
              form.reset({
                teacherId: fixedTeacherId ?? "",
                fromDate: "",
                toDate: "",
                type: "CASUAL",
                reason: "",
              });
              setDialogOpen(true);
            }}
          >
            Record leave
          </Button>
        </div>
      </Can>

      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
        toolbar={toolbar}
        emptyTitle="No leaves recorded"
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Record leave"
        description="Must fall within the current academic session. Approval is a separate step."
        form={form}
        onSubmit={(values) => create.mutate(values)}
        submitLabel="Record"
        isPending={create.isPending}
      >
        {!fixedTeacherId ? (
          <div className="space-y-2">
            <Label>Teacher</Label>
            <Select
              value={form.watch("teacherId") || undefined}
              onValueChange={(v) =>
                form.setValue("teacherId", v, { shouldValidate: true })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a teacher" />
              </SelectTrigger>
              <SelectContent>
                {(teachers.data?.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.firstName} {t.lastName} ({t.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.teacherId?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.teacherId.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="leave-from">From</Label>
            <Input id="leave-from" type="date" {...form.register("fromDate")} />
            {form.formState.errors.fromDate?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.fromDate.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-to">To</Label>
            <Input id="leave-to" type="date" {...form.register("toDate")} />
            {form.formState.errors.toDate?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.toDate.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={form.watch("type")}
            onValueChange={(v) =>
              form.setValue("type", v as TeacherLeaveValues["type"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAVE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="leave-reason">Reason (optional)</Label>
          <Input id="leave-reason" {...form.register("reason")} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={decideTarget !== null}
        onOpenChange={(open) => !open && setDecideTarget(null)}
        title={
          decideTarget?.action === "approve"
            ? "Approve this leave?"
            : decideTarget?.action === "reject"
              ? "Reject this leave?"
              : "Delete this pending leave?"
        }
        description={
          decideTarget?.action === "approve"
            ? "Approved leaves cannot overlap each other and cannot be edited afterwards. Attendance (Module 12) will mark these days as Leave."
            : undefined
        }
        confirmLabel={
          decideTarget?.action === "approve"
            ? "Approve"
            : decideTarget?.action === "reject"
              ? "Reject"
              : "Delete"
        }
        destructive={decideTarget?.action === "delete"}
        isPending={decide.isPending}
        onConfirm={() => {
          if (decideTarget) decide.mutate(decideTarget);
        }}
      />
    </div>
  );
}
