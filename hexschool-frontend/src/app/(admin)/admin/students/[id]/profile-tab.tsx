"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import { studentsApi, type StudentDetail } from "@/lib/api/students";
import { structureApi } from "@/lib/api/structure";
import { useQuery } from "@tanstack/react-query";
import { BLOOD_GROUPS } from "@/lib/validations/staff";
import {
  RELIGIONS,
  studentPersonalSchema,
  type StudentPersonalValues,
} from "@/lib/validations/student";

const field = (
  label: string,
  input: React.ReactNode,
  error?: string,
) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    {input}
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div>
);

export function ProfileTab({ student }: { student: StudentDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const form = useForm<StudentPersonalValues>({
    resolver: zodResolver(studentPersonalSchema),
    defaultValues: {
      firstName: student.firstName,
      lastName: student.lastName,
      nameBn: student.nameBn ?? "",
      gender: student.gender,
      dob: student.dob,
      bloodGroup:
        (student.bloodGroup as StudentPersonalValues["bloodGroup"]) ?? "",
      religion: student.religion,
      birthCertificateNo: student.birthCertificateNo ?? "",
      admissionDate: student.admissionDate,
      admissionClassId: student.admissionClassId ?? "",
      previousSchool: student.previousSchool ?? "",
    },
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["students"] });

  const save = useMutation({
    mutationFn: (values: StudentPersonalValues) =>
      studentsApi.update(student.id, {
        firstName: values.firstName,
        lastName: values.lastName,
        nameBn: values.nameBn || undefined,
        gender: values.gender,
        dob: values.dob,
        bloodGroup: values.bloodGroup || undefined,
        religion: values.religion,
        birthCertificateNo: values.birthCertificateNo || undefined,
        admissionDate: values.admissionDate,
        admissionClassId: values.admissionClassId,
        previousSchool: values.previousSchool || undefined,
      }),
    onSuccess: () => {
      toast.success("Profile saved");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => studentsApi.uploadPhoto(student.id, file),
    onSuccess: () => {
      toast.success("Photo updated");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const address = useMutation({
    mutationFn: (values: { present: string; permanent: string }) =>
      studentsApi.update(student.id, {
        presentAddress: { present: values.present },
        permanentAddress: { permanent: values.permanent },
      }),
    onSuccess: () => {
      toast.success("Address saved");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rotateQr = useMutation({
    mutationFn: () => studentsApi.rotateQr(student.id),
    onSuccess: () => {
      toast.success("QR token rotated — previously printed cards no longer verify.");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => studentsApi.remove(student.id),
    onSuccess: () => {
      toast.success("Student deleted — the UID stays reserved permanently.");
      invalidate();
      router.push("/admin/students");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const [present, setPresent] = useState(student.presentAddress?.present ?? "");
  const [permanent, setPermanent] = useState(
    student.permanentAddress?.permanent ?? "",
  );

  return (
    <div className="max-w-3xl space-y-6">
      <Can permission="student.update">
        <div className="flex items-center gap-3 rounded-lg border p-4">
          {student.photoSignedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={student.photoSignedUrl}
              alt=""
              className="size-16 rounded-md object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
              No photo
            </div>
          )}
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadPhoto.mutate(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploadPhoto.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {student.photoUrl ? "Replace photo" : "Upload photo"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              JPEG/PNG/WebP, ≤2 MB — normalized to 512px.
            </p>
          </div>
        </div>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
          >
            {field(
              "First name",
              <Input {...form.register("firstName")} />,
              form.formState.errors.firstName?.message,
            )}
            {field(
              "Last name",
              <Input {...form.register("lastName")} />,
              form.formState.errors.lastName?.message,
            )}
            {field("Name (Bangla)", <Input {...form.register("nameBn")} />)}
            {field(
              "Gender",
              <Select
                value={form.watch("gender")}
                onValueChange={(v) =>
                  form.setValue("gender", v as StudentPersonalValues["gender"])
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["MALE", "FEMALE", "OTHER"].map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
            {field(
              "Date of birth",
              <Input type="date" {...form.register("dob")} />,
              form.formState.errors.dob?.message,
            )}
            {field(
              "Blood group",
              <Select
                value={form.watch("bloodGroup") || "none"}
                onValueChange={(v) =>
                  form.setValue(
                    "bloodGroup",
                    (v === "none"
                      ? ""
                      : v) as StudentPersonalValues["bloodGroup"],
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unknown</SelectItem>
                  {BLOOD_GROUPS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
            {field(
              "Religion",
              <Select
                value={form.watch("religion")}
                onValueChange={(v) =>
                  form.setValue("religion", v as StudentPersonalValues["religion"])
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELIGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
            {field(
              "Birth certificate no",
              <Input {...form.register("birthCertificateNo")} />,
              form.formState.errors.birthCertificateNo?.message,
            )}
            {field(
              "Admission date",
              <Input type="date" {...form.register("admissionDate")} />,
              form.formState.errors.admissionDate?.message,
            )}
            {field(
              "Admission class",
              <Select
                value={form.watch("admissionClassId")}
                onValueChange={(v) =>
                  form.setValue("admissionClassId", v, { shouldValidate: true })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a class" />
                </SelectTrigger>
                <SelectContent>
                  {(classes.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
              form.formState.errors.admissionClassId?.message,
            )}
            {field(
              "Previous school",
              <Input {...form.register("previousSchool")} />,
            )}
            <Can permission="student.update">
              <div className="md:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </Can>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {field(
            "Present address",
            <Textarea
              rows={2}
              value={present}
              onChange={(e) => setPresent(e.target.value)}
            />,
          )}
          {field(
            "Permanent address",
            <Textarea
              rows={2}
              value={permanent}
              onChange={(e) => setPermanent(e.target.value)}
            />,
          )}
          <Can permission="student.update">
            <Button
              variant="outline"
              disabled={address.isPending}
              onClick={() => address.mutate({ present, permanent })}
            >
              Save address
            </Button>
          </Can>
        </CardContent>
      </Card>

      <Can permission="student.update">
        <Card>
          <CardHeader>
            <CardTitle>ID card QR</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Rotate the QR token if a printed card is lost or stolen — old
              cards stop verifying immediately.
            </p>
            <Button
              variant="outline"
              disabled={rotateQr.isPending}
              onClick={() => rotateQr.mutate()}
            >
              Rotate QR token
            </Button>
          </CardContent>
        </Card>
      </Can>

      <Can permission="student.delete">
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 p-4">
          <div>
            <p className="font-medium">Delete student</p>
            <p className="text-sm text-muted-foreground">
              Soft-deletes the record and deactivates any portal account. The
              UID stays permanently reserved.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      </Can>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${student.firstName} ${student.lastName}?`}
        description="This soft-deletes the student and deactivates their portal account. The UID is never reused."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
