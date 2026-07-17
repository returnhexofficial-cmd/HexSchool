"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import { studentsApi } from "@/lib/api/students";
import {
  studentMedicalSchema,
  type StudentMedicalValues,
} from "@/lib/validations/student";

export function MedicalTab({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();

  const medical = useQuery({
    queryKey: ["students", studentId, "medical"],
    queryFn: () => studentsApi.getMedical(studentId),
  });

  const form = useForm<StudentMedicalValues>({
    resolver: zodResolver(studentMedicalSchema),
    defaultValues: {
      heightCm: "",
      weightKg: "",
      allergies: "",
      chronicConditions: "",
      disabilities: "",
      emergencyNotes: "",
    },
  });

  useEffect(() => {
    if (medical.data) {
      form.reset({
        heightCm: medical.data.heightCm ? String(medical.data.heightCm) : "",
        weightKg: medical.data.weightKg ? String(medical.data.weightKg) : "",
        allergies: medical.data.allergies ?? "",
        chronicConditions: medical.data.chronicConditions ?? "",
        disabilities: medical.data.disabilities ?? "",
        emergencyNotes: medical.data.emergencyNotes ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medical.data]);

  const save = useMutation({
    mutationFn: (values: StudentMedicalValues) =>
      studentsApi.updateMedical(studentId, {
        heightCm: values.heightCm ? Number(values.heightCm) : undefined,
        weightKg: values.weightKg ? Number(values.weightKg) : undefined,
        allergies: values.allergies || undefined,
        chronicConditions: values.chronicConditions || undefined,
        disabilities: values.disabilities || undefined,
        emergencyNotes: values.emergencyNotes || undefined,
      }),
    onSuccess: () => {
      toast.success("Medical record saved");
      void queryClient.invalidateQueries({
        queryKey: ["students", studentId, "medical"],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (medical.isPending) return <LoadingBlock />;
  if (medical.isError)
    return <ErrorState error={medical.error} onRetry={() => void medical.refetch()} />;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Medical information</CardTitle>
        <p className="text-sm text-muted-foreground">
          Restricted to roles with the student.medical.view permission. Never
          included in exports by default.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <div className="space-y-2">
            <Label>Height (cm)</Label>
            <Input {...form.register("heightCm")} />
            {form.formState.errors.heightCm?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.heightCm.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Weight (kg)</Label>
            <Input {...form.register("weightKg")} />
            {form.formState.errors.weightKg?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.weightKg.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Allergies</Label>
            <Textarea rows={2} {...form.register("allergies")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Chronic conditions</Label>
            <Textarea rows={2} {...form.register("chronicConditions")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Disabilities</Label>
            <Textarea rows={2} {...form.register("disabilities")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Emergency notes</Label>
            <Textarea rows={2} {...form.register("emergencyNotes")} />
          </div>
          <Can permission="student.medical.update">
            <div className="md:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save medical record"}
              </Button>
            </div>
          </Can>
        </form>
      </CardContent>
    </Card>
  );
}
