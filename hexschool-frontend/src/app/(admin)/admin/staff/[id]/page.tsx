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
import { DESIGNATION_LABELS, staffApi } from "@/lib/api/staff";
import { cn } from "@/lib/utils";
import {
  staffStatusSchema,
  type StaffStatusValues,
} from "@/lib/validations/staff";
import { ActivityTab } from "./activity-tab";
import { DocumentsTab } from "./documents-tab";
import { ProfileTab } from "./profile-tab";
import { RolesTab } from "./roles-tab";

const TABS = [
  ["profile", "Profile"],
  ["documents", "Documents"],
  ["roles", "Roles"],
  ["activity", "Activity"],
] as const;

type TabKey = (typeof TABS)[number][0];

/**
 * Staff detail (roadmap M07 §5): profile editor, documents, the user
 * role-assignment slot promised in M03, and the audit-log activity tab.
 */
export default function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("profile");
  const [statusOpen, setStatusOpen] = useState(false);

  const staff = useQuery({
    queryKey: ["staff", id],
    queryFn: () => staffApi.get(id),
  });

  const statusForm = useForm<StaffStatusValues>({
    resolver: zodResolver(staffStatusSchema),
    defaultValues: { status: "ACTIVE", reason: "" },
  });

  const changeStatus = useMutation({
    mutationFn: (values: StaffStatusValues) =>
      staffApi.updateStatus(id, values),
    onSuccess: (_, values) => {
      toast.success(
        values.status === "RESIGNED" || values.status === "TERMINATED"
          ? `Status set to ${values.status} — the user account was deactivated.`
          : `Status set to ${values.status}.`,
      );
      setStatusOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (staff.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (staff.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
      </main>
    );
  }

  const s = staff.data;

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
        description={`${s.employeeId} · ${DESIGNATION_LABELS[s.designation]}${
          s.department ? ` · ${s.department.name}` : ""
        }`}
      >
        <Can permission="staff.status">
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

      <div className="flex gap-1 border-b">
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
        <ProfileTab staff={s} />
      ) : tab === "documents" ? (
        <DocumentsTab staffId={s.id} />
      ) : tab === "roles" ? (
        <RolesTab userId={s.userId} />
      ) : (
        <ActivityTab staffId={s.id} />
      )}

      <FormDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Change employment status"
        description="RESIGNED and TERMINATED immediately deactivate the user account and sign out every device."
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
          <Label htmlFor="status-reason">Reason</Label>
          <Input
            id="status-reason"
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
