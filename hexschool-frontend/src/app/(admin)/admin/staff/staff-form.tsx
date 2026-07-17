"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider } from "react-hook-form";
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
  DESIGNATION_LABELS,
  staffApi,
  type StaffDetail,
  type StaffInput,
} from "@/lib/api/staff";
import { structureApi } from "@/lib/api/structure";
import { useDebounce } from "@/lib/hooks/use-debounce";
import {
  BLOOD_GROUPS,
  DESIGNATIONS,
  staffSchema,
  type StaffFormValues,
} from "@/lib/validations/staff";

const NONE = "__none__";

const emptyValues: StaffFormValues = {
  email: "",
  phone: "",
  firstName: "",
  lastName: "",
  nameBn: "",
  designation: "OFFICE_STAFF",
  departmentId: "",
  gender: "MALE",
  dob: "",
  bloodGroup: "",
  nidNumber: "",
  presentAddress: "",
  permanentAddress: "",
  joiningDate: "",
  employmentType: "PERMANENT",
};

export function toFormValues(staff: StaffDetail): StaffFormValues {
  return {
    email: staff.user.email ?? "",
    phone: staff.user.phone ?? "",
    firstName: staff.firstName,
    lastName: staff.lastName,
    nameBn: staff.nameBn ?? "",
    designation: staff.designation,
    departmentId: staff.departmentId ?? "",
    gender: staff.gender,
    dob: staff.dob.slice(0, 10),
    bloodGroup: (staff.bloodGroup ?? "") as StaffFormValues["bloodGroup"],
    nidNumber: staff.nidNumber ?? "",
    presentAddress: staff.address?.present ?? "",
    permanentAddress: staff.address?.permanent ?? "",
    joiningDate: staff.joiningDate.slice(0, 10),
    employmentType: staff.employmentType,
  };
}

export function toApiInput(values: StaffFormValues): StaffInput {
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
    employmentType: values.employmentType,
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
  return message ? (
    <p className="text-sm text-destructive">{message}</p>
  ) : null;
}

/**
 * Multi-section staff form (roadmap M07 §5) shared by the create page and
 * the detail Profile tab. NID duplicates warn inline (soft check via
 * GET /staff/check-nid) but never block submission.
 */
export function StaffForm({
  initial,
  excludeIdForNidCheck,
  submitLabel,
  isPending,
  onSubmit,
}: {
  initial?: StaffFormValues;
  excludeIdForNidCheck?: string;
  submitLabel: string;
  isPending: boolean;
  onSubmit: (values: StaffFormValues) => void;
}) {
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: initial ?? emptyValues,
  });

  const departments = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => structureApi.departments.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const nid = form.watch("nidNumber") ?? "";
  const debouncedNid = useDebounce(nid, 400);
  const [nidWarning, setNidWarning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (/^(\d{10}|\d{13}|\d{17})$/.test(debouncedNid)) {
      staffApi
        .checkNid(debouncedNid, excludeIdForNidCheck)
        .then((exists) => {
          if (!cancelled) setNidWarning(exists);
        })
        .catch(() => undefined);
    } else {
      setNidWarning(false);
    }
    return () => {
      cancelled = true;
    };
  }, [debouncedNid, excludeIdForNidCheck]);

  const selectField = (
    name: "designation" | "gender" | "employmentType" | "bloodGroup" | "departmentId",
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
              <Label htmlFor="staff-email">Email (optional)</Label>
              <Input
                id="staff-email"
                placeholder="name@school.edu.bd"
                {...form.register("email")}
              />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-phone">Phone (BD mobile)</Label>
              <Input
                id="staff-phone"
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
              <Label htmlFor="staff-first">First name</Label>
              <Input id="staff-first" {...form.register("firstName")} />
              <FieldError message={errors.firstName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-last">Last name</Label>
              <Input id="staff-last" {...form.register("lastName")} />
              <FieldError message={errors.lastName?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-bn">Name (Bangla, optional)</Label>
              <Input id="staff-bn" {...form.register("nameBn")} />
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
              <Label htmlFor="staff-dob">Date of birth</Label>
              <Input id="staff-dob" type="date" {...form.register("dob")} />
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
              <Label htmlFor="staff-nid">NID (optional)</Label>
              <Input
                id="staff-nid"
                placeholder="10, 13 or 17 digits"
                {...form.register("nidNumber")}
              />
              <FieldError message={errors.nidNumber?.message} />
              {nidWarning ? (
                <p className="text-sm text-amber-600">
                  Another staff member already has this NID — double-check
                  before saving (this will not block you).
                </p>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title="Employment">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Designation</Label>
              {selectField(
                "designation",
                DESIGNATIONS.map((d) => ({
                  value: d,
                  label: DESIGNATION_LABELS[d],
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
              <Label htmlFor="staff-joining">Joining date</Label>
              <Input
                id="staff-joining"
                type="date"
                {...form.register("joiningDate")}
              />
              <FieldError message={errors.joiningDate?.message} />
            </div>
            <div className="space-y-2">
              <Label>Employment type</Label>
              {selectField("employmentType", [
                { value: "PERMANENT", label: "Permanent" },
                { value: "CONTRACT", label: "Contract" },
                { value: "PART_TIME", label: "Part-time" },
              ])}
            </div>
          </div>
        </Section>

        <Section title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="staff-present">Present address</Label>
              <Input id="staff-present" {...form.register("presentAddress")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-permanent">Permanent address</Label>
              <Input
                id="staff-permanent"
                {...form.register("permanentAddress")}
              />
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
