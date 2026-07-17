"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { teachersApi, type TeacherDetail } from "@/lib/api/teachers";
import type { TeacherFormValues } from "@/lib/validations/teacher";
import { TeacherForm, toApiInput, toFormValues } from "../teacher-form";

export function ProfileTab({ teacher }: { teacher: TeacherDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["teachers"] });

  const save = useMutation({
    mutationFn: (values: TeacherFormValues) =>
      teachersApi.update(teacher.id, toApiInput(values)),
    onSuccess: () => {
      toast.success("Profile saved");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => teachersApi.uploadPhoto(teacher.id, file),
    onSuccess: () => {
      toast.success("Photo updated");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => teachersApi.remove(teacher.id),
    onSuccess: () => {
      toast.success("Teacher deleted — their account was deactivated.");
      invalidate();
      router.push("/admin/teachers");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <Can permission="teacher.update">
        <div className="flex items-center gap-3 rounded-lg border p-4">
          {teacher.photoSignedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.photoSignedUrl}
              alt=""
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-lg font-semibold">
              {teacher.firstName[0]}
              {teacher.lastName[0]}
            </div>
          )}
          <div className="flex-1 text-sm text-muted-foreground">
            JPEG/PNG/WebP up to 2 MB — normalized to a 512px square.
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadPhoto.mutate(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploadPhoto.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {uploadPhoto.isPending ? "Uploading…" : "Upload photo"}
          </Button>
        </div>
      </Can>

      <TeacherForm
        key={teacher.updatedAt}
        initial={toFormValues(teacher)}
        submitLabel="Save changes"
        isPending={save.isPending}
        onSubmit={(values) => save.mutate(values)}
      />

      <Can permission="teacher.delete">
        <div className="flex justify-between rounded-lg border border-destructive/40 p-4">
          <div className="text-sm text-muted-foreground">
            Blocked while current-session assignments or class-teacher duties
            exist. Deactivates the account; the employee ID is never reused.
          </div>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete teacher
          </Button>
        </div>
      </Can>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${teacher.firstName} ${teacher.lastName}?`}
        description="Their user account is deactivated and signed out everywhere."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
