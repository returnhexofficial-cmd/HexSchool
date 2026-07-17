"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { apiErrorMessage } from "@/lib/api/auth";
import { teachersApi } from "@/lib/api/teachers";
import type { TeacherFormValues } from "@/lib/validations/teacher";
import { TeacherForm, toApiInput } from "../teacher-form";

export default function NewTeacherPage() {
  const router = useRouter();

  const create = useMutation({
    mutationFn: (values: TeacherFormValues) =>
      teachersApi.create(toApiInput(values)),
    onSuccess: (teacher) => {
      toast.success(
        `${teacher.firstName} ${teacher.lastName} registered — ID ${teacher.employeeId}. Login credentials were sent to their contact.`,
      );
      router.push(`/admin/teachers/${teacher.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="New teacher"
        description="Creates the profile AND a user account with the teacher role (temp password sent by SMS/email)"
      />
      <div className="max-w-3xl">
        <TeacherForm
          submitLabel="Register teacher"
          isPending={create.isPending}
          onSubmit={(values) => create.mutate(values)}
        />
      </div>
    </main>
  );
}
