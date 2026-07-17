"use client";

import { useQuery } from "@tanstack/react-query";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Spinner } from "@/components/shared/spinner";
import {
  TEACHER_DESIGNATION_LABELS,
  type TeacherDetail,
  type TeacherInput,
} from "@/lib/api/teachers";
import { structureApi } from "@/lib/api/structure";
import { BLOOD_GROUPS } from "@/lib/validations/staff";
import {
  TEACHER_DESIGNATIONS,
  teacherSchema,
  type TeacherFormValues,
} from "@/lib/validations/teacher";

const NONE = "__none__";

const emptyValues: TeacherFormValues = {
  email: "",
  phone: "",
  firstName: "",
  lastName: "",
  nameBn: "",
  designation: "ASSISTANT_TEACHER",
  departmentId: "",
  gender: "MALE",
  dob: "",
  bloodGroup: "",
  nidNumber: "",
  presentAddress: "",
  permanentAddress: "",
  joiningDate: "",
  salaryGrade: "",
  mpoIndexNo: "",
  specialization: "",
};

export function toFormValues(teacher: TeacherDetail): TeacherFormValues {
  return {
    email: teacher.user.email ?? "",
    phone: teacher.user.phone ?? "",
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    nameBn: teacher.nameBn ?? "",
    designation: teacher.designation,
    departmentId: teacher.departmentId ?? "",
    gender: teacher.gender,
    dob: teacher.dob.slice(0, 10),
    bloodGroup: (teacher.bloodGroup ?? "") as TeacherFormValues["bloodGroup"],
    nidNumber: teacher.nidNumber ?? "",
    presentAddress: teacher.address?.present ?? "",
    permanentAddress: teacher.address?.permanent ?? "",
    joiningDate: teacher.joiningDate.slice(0, 10),
    salaryGrade: teacher.salaryGrade ?? "",
    mpoIndexNo: teacher.mpoIndexNo ?? "",
    specialization: teacher.specialization ?? "",
  };
}

export function toApiInput(values: TeacherFormValues): TeacherInput {
  return {
    email: values.email || undefined,
    phone: values.phone || undefined,
    firstName: values.firstName,
    lastName: values.lastName,
    nameBn: values.nameBn || undefined,
    designation: values.designation,
    departmentId: values.departmentId || undefined,
    gender: values.gender,
    dob: values.dob,
    bloodGroup: values.bloodGroup || undefined,
    nidNumber: values.nidNumber || undefined,
    address: {
      ...(values.presentAddress ? { present: values.presentAddress } : {}),
      ...(values.permanentAddress
        ? { permanent: values.permanentAddress }
        : {}),
    },
    joiningDate: values.joiningDate,
    salaryGrade: values.salaryGrade || undefined,
    mpoIndexNo: values.mpoIndexNo || undefined,
    specialization: values.specialization || undefined,
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

/** Multi-section teacher form (M08 §5) — same layout family as StaffForm. */
export function TeacherForm({
  initial,
  submitLabel,
  isPending,
  onSubmit,
}: {
  initial?: TeacherFormValues;
  submitLabel: string;
  isPending: boolean;
  onSubmit: (values: TeacherFormValues) => void;
}) {
  const form = useForm<TeacherFormValues>({
    resolver: zodResolver(teacherSchema),
    defaultValues: initial ?? emptyValues,
  });

  const departments = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => structureApi.departments.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const selectField = (
    name:
      | "designation"
      | "gender"
      | "bloodGroup"
      | "departmentId",
    items: Array<{ value: string; label: string }>,
    allowNone = false,
  ) => (
    <Select
      value={form.watch(name) || (allowNone ? NONE : undefined)}
      onValueChange={(v) =>
        form.setValue(name, (v === NONE ? "" : v) as never, {
          shouldValidate: true,
        })
      }
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>None</SelectItem> : null}
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const errors = form.formState.errors;

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        <Section title="Account (login credentials go to this contact)">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="t-email">Email (optional)</Label>
              <Input id="t-email" {...form.register("email")} />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-phone">Phone (BD mobile)</Label>
              <Input
                id="t-phone"
                placeholder="01XXXXXXXXX"
                {...form.register("phone")}
              />
              <FieldError message={errors.phone?.message} />
            </div>
          </div>
        </Section>

        <Section title="Personal">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="t-first">First name</Label>
              <Input id="t-first" {...form.register("firstName")} />
              <FieldError message={errors.firstName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-last">Last name</Label>
              <Input id="t-last" {...form.register("lastName")} />
              <FieldError message={errors.lastName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-bn">Name (Bangla, optional)</Label>
              <Input id="t-bn" {...form.register("nameBn")} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              {selectField("gender", [
                { value: "MALE", label: "Male" },
                { value: "FEMALE", label: "Female" },
                { value: "OTHER", label: "Other" },
              ])}
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-dob">Date of birth</Label>
              <Input id="t-dob" type="date" {...form.register("dob")} />
              <FieldError message={errors.dob?.message} />
            </div>
            <div className="space-y-2">
              <Label>Blood group (optional)</Label>
              {selectField(
                "bloodGroup",
                BLOOD_GROUPS.map((g) => ({ value: g, label: g })),
                true,
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="t-nid">NID (optional)</Label>
              <Input
                id="t-nid"
                placeholder="10, 13 or 17 digits"
                {...form.register("nidNumber")}
              />
              <FieldError message={errors.nidNumber?.message} />
            </div>
          </div>
        </Section>

        <Section title="Employment">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Designation</Label>
              {selectField(
                "designation",
                TEACHER_DESIGNATIONS.map((d) => ({
                  value: d,
                  label: TEACHER_DESIGNATION_LABELS[d],
                })),
              )}
            </div>
            <div className="space-y-2">
              <Label>Department (optional)</Label>
              {selectField(
                "departmentId",
                (departments.data?.data ?? []).map((d) => ({
                  value: d.id,
                  label: d.name,
                })),
                true,
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-joining">Joining date</Label>
              <Input
                id="t-joining"
                type="date"
                {...form.register("joiningDate")}
              />
              <FieldError message={errors.joiningDate?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-specialization">Specialization</Label>
              <Input
                id="t-specialization"
                placeholder="Mathematics"
                {...form.register("specialization")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-grade">Salary grade (optional)</Label>
              <Input id="t-grade" {...form.register("salaryGrade")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-mpo">MPO index no (optional)</Label>
              <Input id="t-mpo" {...form.register("mpoIndexNo")} />
            </div>
          </div>
        </Section>

        <Section title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="t-present">Present address</Label>
              <Input id="t-present" {...form.register("presentAddress")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-permanent">Permanent address</Label>
              <Input id="t-permanent" {...form.register("permanentAddress")} />
            </div>
          </div>
        </Section>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner className="mr-1 size-4" /> : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
