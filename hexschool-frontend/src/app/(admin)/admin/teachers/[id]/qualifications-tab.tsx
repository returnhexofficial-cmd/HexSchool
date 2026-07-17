"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { teachersApi, type Qualification } from "@/lib/api/teachers";
import {
  qualificationSchema,
  type QualificationValues,
} from "@/lib/validations/teacher";

export function QualificationsTab({ teacherId }: { teacherId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Qualification | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Qualification | null>(null);

  const qualifications = useQuery({
    queryKey: ["teacher-qualifications", teacherId],
    queryFn: () => teachersApi.listQualifications(teacherId),
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["teacher-qualifications", teacherId],
    });

  const form = useForm<QualificationValues>({
    resolver: zodResolver(qualificationSchema),
    defaultValues: { degree: "", institution: "", passingYear: "", result: "" },
  });

  const save = useMutation({
    mutationFn: (values: QualificationValues) => {
      const input = {
        degree: values.degree,
        institution: values.institution,
        passingYear: Number(values.passingYear),
        result: values.result || undefined,
      };
      return editing
        ? teachersApi.updateQualification(teacherId, editing.id, input)
        : teachersApi.addQualification(teacherId, input);
    },
    onSuccess: () => {
      toast.success(editing ? "Qualification saved" : "Qualification added");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (qid: string) =>
      teachersApi.removeQualification(teacherId, qid),
    onSuccess: () => {
      toast.success("Qualification deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (qualifications.isPending) return <LoadingBlock />;
  if (qualifications.isError) {
    return (
      <ErrorState
        error={qualifications.error}
        onRetry={() => void qualifications.refetch()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Can permission="teacher.qualification.manage">
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditing(null);
              form.reset({
                degree: "",
                institution: "",
                passingYear: "",
                result: "",
              });
              setDialogOpen(true);
            }}
          >
            Add qualification
          </Button>
        </div>
      </Can>

      {qualifications.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No qualifications recorded (SSC, HSC, BSc, BEd, MSc…).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Degree</th>
                <th className="px-3 py-2 font-medium">Institution</th>
                <th className="px-3 py-2 font-medium">Year</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {qualifications.data.map((q) => (
                <tr key={q.id}>
                  <td className="px-3 py-2 font-medium">{q.degree}</td>
                  <td className="px-3 py-2">{q.institution}</td>
                  <td className="px-3 py-2">{q.passingYear}</td>
                  <td className="px-3 py-2">{q.result ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Can permission="teacher.qualification.manage">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(q);
                            form.reset({
                              degree: q.degree,
                              institution: q.institution,
                              passingYear: String(q.passingYear),
                              result: q.result ?? "",
                            });
                            setDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(q)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit qualification" : "Add qualification"}
        form={form}
        onSubmit={(values) => save.mutate(values)}
        submitLabel={editing ? "Save" : "Add"}
        isPending={save.isPending}
      >
        <div className="space-y-2">
          <Label htmlFor="q-degree">Degree</Label>
          <Input
            id="q-degree"
            placeholder="BSc in Mathematics"
            {...form.register("degree")}
          />
          {form.formState.errors.degree?.message ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.degree.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="q-institution">Institution</Label>
          <Input id="q-institution" {...form.register("institution")} />
          {form.formState.errors.institution?.message ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.institution.message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="q-year">Passing year</Label>
            <Input id="q-year" placeholder="2008" {...form.register("passingYear")} />
            {form.formState.errors.passingYear?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.passingYear.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="q-result">Result (optional)</Label>
            <Input id="q-result" placeholder="First class" {...form.register("result")} />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.degree}"?`}
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={() => {
          if (deleteTarget) del.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
