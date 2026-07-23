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
import { usePermissions } from "@/lib/hooks/use-permissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { studentsApi } from "@/lib/api/students";
import { cn } from "@/lib/utils";
import {
  studentStatusSchema,
  STUDENT_STATUSES,
  type StudentStatusValues,
} from "@/lib/validations/student";
import { ProfileTab } from "./profile-tab";
import { GuardiansTab } from "./guardians-tab";
import { MedicalTab } from "./medical-tab";
import { DocumentsTab } from "./documents-tab";
import { TimelineTab } from "./timeline-tab";
import { HistoryTab } from "./history-tab";
import { StudentFeesTab } from "./fees-tab";

const TABS = [
  ["profile", "Profile", null],
  ["guardians", "Guardians", null],
  ["medical", "Medical", "student.medical.view"],
  ["documents", "Documents", null],
  ["attendance", "Attendance", null],
  ["results", "Results", null],
  ["fees", "Fees", "fee.view"],
  ["timeline", "Timeline", null],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [tab, setTab] = useState<TabKey>("profile");
  const [statusOpen, setStatusOpen] = useState(false);

  const student = useQuery({
    queryKey: ["students", id],
    queryFn: () => studentsApi.get(id),
  });

  const statusForm = useForm<StudentStatusValues>({
    resolver: zodResolver(studentStatusSchema),
    defaultValues: { status: "ACTIVE", reason: "" },
  });

  const changeStatus = useMutation({
    mutationFn: (values: StudentStatusValues) =>
      studentsApi.updateStatus(id, values),
    onSuccess: (result) => {
      toast.success(`Status set to ${result.student.status}.`);
      result.warnings.forEach((w) => toast.warning(w));
      setStatusOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const createAccount = useMutation({
    mutationFn: () => studentsApi.createAccount(id, {}),
    onSuccess: (res) => {
      toast.success(
        `Portal account created. Temp password: ${res.tempPassword}`,
        { duration: 15000 },
      );
      void queryClient.invalidateQueries({ queryKey: ["students", id] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const idCard = useMutation({
    mutationFn: () => studentsApi.downloadIdCard(id, student.data!.studentUid),
    onSuccess: (incomplete) =>
      toast.success(
        incomplete > 0
          ? "ID card downloaded — no photo on file, card flagged incomplete."
          : "ID card downloaded.",
      ),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (student.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (student.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState
          error={student.error}
          onRetry={() => void student.refetch()}
        />
      </main>
    );
  }

  const s = student.data;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {s.photoSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.photoSignedUrl}
                alt=""
                className="size-10 rounded-full object-cover"
              />
            ) : null}
            {s.firstName} {s.lastName}
            <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"}>
              {s.status}
            </Badge>
          </span>
        }
        description={`${s.studentUid} · ${s.admissionClass?.name ?? "—"} · admitted ${s.admissionDate}`}
      >
        <Can permission="student.idcard.generate">
          <Button
            variant="outline"
            disabled={idCard.isPending}
            onClick={() => idCard.mutate()}
          >
            ID card
          </Button>
        </Can>
        {!s.userId ? (
          <Can permission="student.account.create">
            <Button
              variant="outline"
              disabled={createAccount.isPending}
              onClick={() => createAccount.mutate()}
            >
              Create portal account
            </Button>
          </Can>
        ) : null}
        <Can permission="student.status">
          <Button
            variant="outline"
            onClick={() => {
              statusForm.reset({ status: s.status, reason: "" });
              setStatusOpen(true);
            }}
          >
            Change status
          </Button>
        </Can>
      </PageHeader>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.filter(([, , perm]) => !perm || can(perm)).map(([key, label]) => (
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
        <ProfileTab student={s} />
      ) : tab === "guardians" ? (
        <GuardiansTab studentId={s.id} />
      ) : tab === "medical" ? (
        <MedicalTab studentId={s.id} />
      ) : tab === "documents" ? (
        <DocumentsTab studentId={s.id} />
      ) : tab === "attendance" ? (
        <HistoryTab studentId={s.id} kind="attendance" />
      ) : tab === "results" ? (
        <HistoryTab studentId={s.id} kind="performance" />
      ) : tab === "fees" ? (
        <StudentFeesTab studentId={s.id} />
      ) : (
        <TimelineTab studentId={s.id} />
      )}

      <FormDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Change student status"
        description="Exit statuses (Transferred/Graduated/Dropped) deactivate the portal account. A dues clearance check becomes a hard block once Fees (Module 16) lands."
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
              statusForm.setValue(
                "status",
                v as StudentStatusValues["status"],
                { shouldValidate: true },
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STUDENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-status-reason">Reason</Label>
          <Input
            id="s-status-reason"
            placeholder="Recorded in the status history + audit trail"
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
