"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
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
import { teachersApi, type TeacherDocument } from "@/lib/api/teachers";
import {
  staffDocumentSchema,
  type StaffDocumentValues,
} from "@/lib/validations/staff";

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Same contract as the staff Documents tab (M07). */
export function DocumentsTab({ teacherId }: { teacherId: string }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeacherDocument | null>(
    null,
  );

  const docs = useQuery({
    queryKey: ["teacher-documents", teacherId],
    queryFn: () => teachersApi.listDocuments(teacherId),
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["teacher-documents", teacherId],
    });

  const form = useForm<StaffDocumentValues>({
    resolver: zodResolver(staffDocumentSchema),
    defaultValues: { title: "", type: "OTHER" },
  });

  const upload = useMutation({
    mutationFn: (values: StaffDocumentValues) =>
      teachersApi.uploadDocument(teacherId, { ...values, file: file! }),
    onSuccess: () => {
      toast.success("Document uploaded");
      setDialogOpen(false);
      setFile(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (docId: string) =>
      teachersApi.removeDocument(teacherId, docId),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (docs.isPending) return <LoadingBlock />;
  if (docs.isError) {
    return (
      <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
    );
  }

  return (
    <div className="space-y-3">
      <Can permission="teacher.document.manage">
        <div className="flex justify-end">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) {
                if (selected.size > 10 * 1024 * 1024) {
                  toast.error("Documents must be 10 MB or smaller");
                } else {
                  setFile(selected);
                  form.reset({
                    title: selected.name.replace(/\.[^.]+$/, ""),
                    type: "OTHER",
                  });
                  setDialogOpen(true);
                }
              }
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>
            Upload document
          </Button>
        </div>
      </Can>

      {docs.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No documents uploaded yet (NID copy, certificates, CV, contract…).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.data.map((doc) => (
                <tr key={doc.id}>
                  <td className="px-3 py-2 font-medium">{doc.title}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{doc.type}</Badge>
                  </td>
                  <td className="px-3 py-2">{formatBytes(doc.sizeBytes)}</td>
                  <td className="px-3 py-2">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={doc.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      </Button>
                      <Can permission="teacher.document.manage">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(doc)}
                        >
                          Delete
                        </Button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setFile(null);
        }}
        title="Upload document"
        description={
          file ? `File: ${file.name} (${formatBytes(file.size)})` : undefined
        }
        form={form}
        onSubmit={(values) => upload.mutate(values)}
        submitLabel="Upload"
        isPending={upload.isPending}
      >
        <div className="space-y-2">
          <Label htmlFor="tdoc-title">Title</Label>
          <Input id="tdoc-title" {...form.register("title")} />
          {form.formState.errors.title?.message ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.title.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={form.watch("type")}
            onValueChange={(v) =>
              form.setValue("type", v as StaffDocumentValues["type"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["NID", "CERTIFICATE", "CV", "PHOTO", "CONTRACT", "OTHER"].map(
                (type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="Removes the file permanently; the audit trail keeps the history."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
