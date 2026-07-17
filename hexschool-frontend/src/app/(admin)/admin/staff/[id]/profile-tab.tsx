"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { staffApi, type StaffDetail } from "@/lib/api/staff";
import type { StaffFormValues } from "@/lib/validations/staff";
import { StaffForm, toApiInput, toFormValues } from "../staff-form";

export function ProfileTab({ staff }: { staff: StaffDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["staff"] });

  const save = useMutation({
    mutationFn: (values: StaffFormValues) =>
      staffApi.update(staff.id, toApiInput(values)),
    onSuccess: () => {
      toast.success("Profile saved");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => staffApi.uploadPhoto(staff.id, file),
    onSuccess: () => {
      toast.success("Photo updated");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => staffApi.remove(staff.id),
    onSuccess: () => {
      toast.success("Staff member deleted — their account was deactivated.");
      invalidate();
      router.push("/admin/staff");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <Can permission="staff.update">
        <div className="flex items-center gap-3 rounded-lg border p-4">
          {staff.photoSignedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={staff.photoSignedUrl}
              alt=""
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-lg font-semibold">
              {staff.firstName[0]}
              {staff.lastName[0]}
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

      <StaffForm
        key={staff.updatedAt}
        initial={toFormValues(staff)}
        excludeIdForNidCheck={staff.id}
        submitLabel="Save changes"
        isPending={save.isPending}
        onSubmit={(values) => save.mutate(values)}
      />

      <Can permission="staff.delete">
        <div className="flex justify-between rounded-lg border border-destructive/40 p-4">
          <div className="text-sm text-muted-foreground">
            Deleting keeps the record recoverable, deactivates the account,
            and permanently burns the employee ID.
          </div>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete staff member
          </Button>
        </div>
      </Can>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${staff.firstName} ${staff.lastName}?`}
        description="Their user account is deactivated and signed out everywhere. The employee ID is never reused."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
