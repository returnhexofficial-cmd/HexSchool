"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { schoolApi, type School, type SchoolType } from "@/lib/api/school";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  schoolProfileSchema,
  type SchoolProfileValues,
} from "@/lib/validations/school";

const SCHOOL_TYPES: Array<{ value: SchoolType; label: string }> = [
  { value: "PRIMARY", label: "Primary" },
  { value: "HIGH_SCHOOL", label: "High School" },
  { value: "KINDERGARTEN", label: "Kindergarten" },
  { value: "ENGLISH_VERSION", label: "English Version" },
  { value: "ENGLISH_MEDIUM", label: "English Medium" },
  { value: "MADRASA", label: "Madrasa" },
  { value: "VOCATIONAL", label: "Vocational" },
  { value: "COLLEGE", label: "College" },
];

export default function SchoolProfilePage() {
  const school = useQuery({ queryKey: ["school"], queryFn: schoolApi.get });

  if (school.isPending) return <LoadingBlock />;
  if (school.isError) {
    return (
      <ErrorState error={school.error} onRetry={() => void school.refetch()} />
    );
  }
  return <ProfileEditor key={school.data.updatedAt} school={school.data} />;
}

function ProfileEditor({ school }: { school: School }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const editable = can("school.update");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm<SchoolProfileValues>({
    resolver: zodResolver(schoolProfileSchema),
    defaultValues: {
      name: school.name,
      nameBn: school.nameBn ?? "",
      code: school.code,
      eiinNumber: school.eiinNumber ?? "",
      type: school.type,
      address: school.address ?? "",
      phone: school.phone ?? "",
      email: school.email ?? "",
      website: school.website ?? "",
      establishedYear: school.establishedYear
        ? String(school.establishedYear)
        : "",
      principalName: school.principalName ?? "",
    },
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["school"] });

  const save = useMutation({
    mutationFn: (values: SchoolProfileValues) =>
      schoolApi.update({
        ...values,
        nameBn: values.nameBn || undefined,
        eiinNumber: values.eiinNumber || undefined,
        address: values.address || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        website: values.website || undefined,
        principalName: values.principalName || undefined,
        establishedYear: values.establishedYear
          ? Number(values.establishedYear)
          : undefined,
      }),
    onSuccess: () => {
      toast.success("School profile saved");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const uploadLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be 2 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      await schoolApi.uploadLogo(file);
      toast.success("Logo updated");
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const field = (
    name: keyof SchoolProfileValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`school-${name}`}>{label}</Label>
      <Input
        id={`school-${name}`}
        disabled={!editable}
        {...props}
        {...form.register(name)}
      />
      {form.formState.errors[name] ? (
        <p className="text-sm text-destructive">
          {form.formState.errors[name]?.message as string}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            {field("name", "School name")}
            {field("nameBn", "Name (Bangla)")}
            {field("code", "Short code", { placeholder: "HEX" })}
            {field("eiinNumber", "EIIN", { placeholder: "123456" })}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) =>
                  form.setValue("type", v as SchoolType, { shouldDirty: true })
                }
                disabled={!editable}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHOOL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {field("establishedYear", "Established year", {
              type: "number",
              placeholder: "1985",
            })}
            {field("phone", "Phone")}
            {field("email", "Email", { type: "email" })}
            {field("website", "Website", {
              placeholder: "https://school.edu.bd",
            })}
            {field("principalName", "Principal's name")}
            <div className="sm:col-span-2">
              {field("address", "Address")}
            </div>
            <Can permission="school.update">
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  Save profile
                </Button>
              </div>
            </Can>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Label>Logo</Label>
          <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-4">
            {school.logoUrl ? (
              // Signed S3 URL — plain img keeps it simple (no Next loader config).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={school.logoUrl}
                alt={`${school.name} logo`}
                className="max-h-40 max-w-full object-contain"
              />
            ) : (
              <p className="py-8 text-sm text-muted-foreground">
                No logo uploaded
              </p>
            )}
          </div>
          <Can permission="school.update">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload logo"}
            </Button>
            <p className="text-xs text-muted-foreground">
              JPEG/PNG/WebP, max 2 MB — resized to 512px.
            </p>
          </Can>
        </CardContent>
      </Card>
    </div>
  );
}
