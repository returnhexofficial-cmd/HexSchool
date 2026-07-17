"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { apiErrorMessage } from "@/lib/api/auth";
import { TEACHER_DESIGNATION_LABELS, teachersApi } from "@/lib/api/teachers";
import { cn } from "@/lib/utils";
import {
  staffStatusSchema,
  type StaffStatusValues,
} from "@/lib/validations/staff";
import { AssignmentsTab } from "./assignments-tab";
import { DocumentsTab } from "./documents-tab";
import { EvaluationsTab } from "./evaluations-tab";
import { LeavesTab } from "./leaves-tab";
import { ProfileTab } from "./profile-tab";
import { QualificationsTab } from "./qualifications-tab";
import { SubjectsTab } from "./subjects-tab";

const TABS = [
  ["profile", "Profile"],
  ["qualifications", "Qualifications"],
  ["subjects", "Subjects"],
  ["assignments", "Assignments"],
  ["leaves", "Leaves"],
  ["evaluations", "Evaluations"],
  ["documents", "Documents"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function TeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("profile");
  const [statusOpen, setStatusOpen] = useState(false);

  const teacher = useQuery({
    queryKey: ["teachers", id],
    queryFn: () => teachersApi.get(id),
  });

  const statusForm = useForm<StaffStatusValues>({
    resolver: zodResolver(staffStatusSchema),
    defaultValues: { status: "ACTIVE", reason: "" },
  });

  const changeStatus = useMutation({
    mutationFn: (values: StaffStatusValues) =>
      teachersApi.updateStatus(id, values),
    onSuccess: (_, values) => {
      toast.success(`Status set to ${values.status}.`);
      setStatusOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (teacher.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (teacher.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState
          error={teacher.error}
          onRetry={() => void teacher.refetch()}
        />
      </main>
    );
  }

  const t = teacher.data;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {t.photoSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.photoSignedUrl}
                alt=""
                className="size-10 rounded-full object-cover"
              />
            ) : null}
            {t.firstName} {t.lastName}
            <Badge variant={t.status === "ACTIVE" ? "default" : "secondary"}>
              {t.status}
            </Badge>
          </span>
        }
        description={`${t.employeeId} · ${TEACHER_DESIGNATION_LABELS[t.designation]}${
          t.department ? ` · ${t.department.name}` : ""
        }${t.specialization ? ` · ${t.specialization}` : ""}`}
      >
        <Can permission="teacher.status">
          <Button
            variant="outline"
            onClick={() => {
              statusForm.reset({ status: t.status, reason: "" });
              setStatusOpen(true);
            }}
          >
            Change status
          </Button>
        </Can>
      </PageHeader>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "profile" ? (
        <ProfileTab teacher={t} />
      ) : tab === "qualifications" ? (
        <QualificationsTab teacherId={t.id} />
      ) : tab === "subjects" ? (
        <SubjectsTab teacherId={t.id} />
      ) : tab === "assignments" ? (
        <AssignmentsTab teacherId={t.id} />
      ) : tab === "leaves" ? (
        <LeavesTab teacherId={t.id} />
      ) : tab === "evaluations" ? (
        <EvaluationsTab teacherId={t.id} />
      ) : (
        <DocumentsTab teacherId={t.id} />
      )}

      <FormDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Change employment status"
        description="RESIGNED/TERMINATED is blocked while the teacher still holds assignments or class-teacher duties in the current session — transfer them first. It deactivates the account."
        form={statusForm}
        onSubmit={(values) => changeStatus.mutate(values)}
        submitLabel="Apply"
        isPending={changeStatus.isPending}
      >
        <div className="space-y-2">
          <Label>New status</Label>
          <Select
            value={statusForm.watch("status")}
            onValueChange={(v) =>
              statusForm.setValue("status", v as StaffStatusValues["status"], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED", "RETIRED"].map(
                (status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-status-reason">Reason</Label>
          <Input
            id="t-status-reason"
            placeholder="Recorded in the audit trail"
            {...statusForm.register("reason")}
          />
          {statusForm.formState.errors.reason?.message ? (
            <p className="text-sm text-destructive">
              {statusForm.formState.errors.reason.message}
            </p>
          ) : null}
        </div>
      </FormDialog>
    </main>
  );
}
