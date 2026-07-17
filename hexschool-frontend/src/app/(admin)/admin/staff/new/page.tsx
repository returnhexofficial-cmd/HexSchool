"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { apiErrorMessage } from "@/lib/api/auth";
import { staffApi } from "@/lib/api/staff";
import type { StaffFormValues } from "@/lib/validations/staff";
import { StaffForm, toApiInput } from "../staff-form";

export default function NewStaffPage() {
  const router = useRouter();

  const create = useMutation({
    mutationFn: (values: StaffFormValues) =>
      staffApi.create(toApiInput(values)),
    onSuccess: (staff) => {
      toast.success(
        `${staff.firstName} ${staff.lastName} registered — ID ${staff.employeeId}. Login credentials were sent to their contact.`,
      );
      router.push(`/admin/staff/${staff.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="New staff member"
        description="Creates the profile AND a user account with a temporary password (sent by SMS/email)"
      />
      <div className="max-w-3xl">
        <StaffForm
          submitLabel="Register staff member"
          isPending={create.isPending}
          onSubmit={(values) => create.mutate(values)}
        />
      </div>
    </main>
  );
}
