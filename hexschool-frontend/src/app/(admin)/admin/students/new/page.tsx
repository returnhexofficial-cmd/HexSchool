"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  GUARDIAN_RELATION_LABELS,
  guardiansApi,
  studentsApi,
  type DuplicateWarning,
  type GuardianRelation,
  type StudentDocumentType,
  type StudentInput,
} from "@/lib/api/students";
import { structureApi } from "@/lib/api/structure";
import { BLOOD_GROUPS } from "@/lib/validations/staff";
import {
  GUARDIAN_RELATIONS,
  RELIGIONS,
  STUDENT_DOCUMENT_TYPES,
  guardianEntrySchema,
  studentAddressSchema,
  studentMedicalSchema,
  studentPersonalSchema,
  validateGuardianEntries,
  type GuardianEntryValues,
  type StudentAddressValues,
  type StudentMedicalValues,
  type StudentPersonalValues,
} from "@/lib/validations/student";

const STEPS = [
  "Personal",
  "Guardians",
  "Address",
  "Medical",
  "Documents",
  "Review",
] as const;

interface QueuedDocument {
  file: File;
  title: string;
  type: StudentDocumentType;
}

const field = (
  label: string,
  input: React.ReactNode,
  error?: string,
  hint?: string,
) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    {input}
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div>
);

export default function StudentRegistrationWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [guardians, setGuardians] = useState<GuardianEntryValues[]>([]);
  const [documents, setDocuments] = useState<QueuedDocument[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[] | null>(null);

  const personal = useForm<StudentPersonalValues>({
    resolver: zodResolver(studentPersonalSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      nameBn: "",
      gender: "MALE",
      dob: "",
      bloodGroup: "",
      religion: "ISLAM",
      birthCertificateNo: "",
      admissionDate: new Date().toISOString().slice(0, 10),
      admissionClassId: "",
      previousSchool: "",
    },
  });
  const address = useForm<StudentAddressValues>({
    resolver: zodResolver(studentAddressSchema),
    defaultValues: { presentAddress: "", permanentAddress: "" },
  });
  const medical = useForm<StudentMedicalValues>({
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

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const checkDuplicates = useMutation({
    mutationFn: () =>
      studentsApi.checkDuplicates({
        firstName: personal.getValues("firstName"),
        lastName: personal.getValues("lastName"),
        dob: personal.getValues("dob"),
        guardianPhones: guardians
          .map((g) => g.phone)
          .filter((p): p is string => !!p),
      }),
    onSuccess: setDuplicates,
    onError: () => setDuplicates([]),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const p = personal.getValues();
      const a = address.getValues();
      const m = medical.getValues();

      const input: StudentInput = {
        firstName: p.firstName,
        lastName: p.lastName,
        nameBn: p.nameBn || undefined,
        gender: p.gender,
        dob: p.dob,
        bloodGroup: p.bloodGroup || undefined,
        religion: p.religion,
        birthCertificateNo: p.birthCertificateNo || undefined,
        presentAddress: a.presentAddress
          ? { present: a.presentAddress }
          : undefined,
        permanentAddress: a.permanentAddress
          ? { permanent: a.permanentAddress }
          : undefined,
        admissionDate: p.admissionDate,
        admissionClassId: p.admissionClassId,
        previousSchool: p.previousSchool || undefined,
        guardians: guardians.map((g) => ({
          guardianId: g.guardianId || undefined,
          name: g.name || undefined,
          phone: g.phone || undefined,
          email: g.email || undefined,
          nid: g.nid || undefined,
          occupation: g.occupation || undefined,
          relation: g.relation,
          isPrimary: g.isPrimary,
          isEmergencyContact: g.isEmergencyContact,
        })),
      };

      const created = await studentsApi.create(input);
      const id = created.student.id;

      const hasMedical = Object.values(m).some((v) => v);
      if (hasMedical) {
        await studentsApi.updateMedical(id, {
          heightCm: m.heightCm ? Number(m.heightCm) : undefined,
          weightKg: m.weightKg ? Number(m.weightKg) : undefined,
          allergies: m.allergies || undefined,
          chronicConditions: m.chronicConditions || undefined,
          disabilities: m.disabilities || undefined,
          emergencyNotes: m.emergencyNotes || undefined,
        });
      }
      for (const doc of documents) {
        await studentsApi.uploadDocument(id, doc);
      }
      return created;
    },
    onSuccess: (created) => {
      toast.success(
        `Registered ${created.student.firstName} ${created.student.lastName} as ${created.student.studentUid}.`,
      );
      created.warnings.forEach((w) => toast.warning(w));
      if (created.duplicateWarnings.length > 0) {
        toast.warning(
          `Possible duplicate of ${created.duplicateWarnings
            .map((d) => d.studentUid)
            .join(", ")} — review if unintended.`,
        );
      }
      router.push(`/admin/students/${created.student.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const next = async () => {
    if (step === 0 && !(await personal.trigger())) return;
    if (step === 1) {
      const problem = validateGuardianEntries(guardians);
      if (problem) {
        toast.error(problem);
        return;
      }
      // Single unmarked guardian → primary implicitly (backend mirrors).
      if (guardians.length === 1 && !guardians[0].isPrimary) {
        setGuardians([{ ...guardians[0], isPrimary: true }]);
      }
    }
    if (step === 2 && !(await address.trigger())) return;
    if (step === 3 && !(await medical.trigger())) return;
    if (step === 4) {
      setDuplicates(null);
      checkDuplicates.mutate();
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const p = personal;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Register student"
        description="Personal → Guardians → Address → Medical → Documents → Review"
      />

      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <Badge
            key={label}
            variant={i === step ? "default" : i < step ? "secondary" : "outline"}
          >
            {i + 1}. {label}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {field(
                "First name",
                <Input {...p.register("firstName")} />,
                p.formState.errors.firstName?.message,
              )}
              {field(
                "Last name",
                <Input {...p.register("lastName")} />,
                p.formState.errors.lastName?.message,
              )}
              {field(
                "Name (Bangla)",
                <Input {...p.register("nameBn")} />,
                p.formState.errors.nameBn?.message,
              )}
              {field(
                "Gender",
                <Select
                  value={p.watch("gender")}
                  onValueChange={(v) =>
                    p.setValue("gender", v as StudentPersonalValues["gender"])
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
                <Input type="date" {...p.register("dob")} />,
                p.formState.errors.dob?.message,
              )}
              {field(
                "Blood group",
                <Select
                  value={p.watch("bloodGroup") || "none"}
                  onValueChange={(v) =>
                    p.setValue(
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
                  value={p.watch("religion")}
                  onValueChange={(v) =>
                    p.setValue(
                      "religion",
                      v as StudentPersonalValues["religion"],
                    )
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
                <Input
                  {...p.register("birthCertificateNo")}
                  placeholder="17 digits"
                />,
                p.formState.errors.birthCertificateNo?.message,
              )}
              {field(
                "Admission date",
                <Input type="date" {...p.register("admissionDate")} />,
                p.formState.errors.admissionDate?.message,
              )}
              {field(
                "Admission class",
                <Select
                  value={p.watch("admissionClassId")}
                  onValueChange={(v) =>
                    p.setValue("admissionClassId", v, { shouldValidate: true })
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
                p.formState.errors.admissionClassId?.message,
              )}
              {field(
                "Previous school",
                <Input {...p.register("previousSchool")} />,
                p.formState.errors.previousSchool?.message,
              )}
            </div>
          ) : step === 1 ? (
            <GuardiansStep guardians={guardians} onChange={setGuardians} />
          ) : step === 2 ? (
            <div className="grid gap-4">
              {field(
                "Present address",
                <Textarea rows={2} {...address.register("presentAddress")} />,
                address.formState.errors.presentAddress?.message,
              )}
              {field(
                "Permanent address",
                <Textarea rows={2} {...address.register("permanentAddress")} />,
                address.formState.errors.permanentAddress?.message,
                "Leave empty to reuse the present address",
              )}
            </div>
          ) : step === 3 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {field(
                "Height (cm)",
                <Input {...medical.register("heightCm")} />,
                medical.formState.errors.heightCm?.message,
              )}
              {field(
                "Weight (kg)",
                <Input {...medical.register("weightKg")} />,
                medical.formState.errors.weightKg?.message,
              )}
              {field(
                "Allergies",
                <Textarea rows={2} {...medical.register("allergies")} />,
              )}
              {field(
                "Chronic conditions",
                <Textarea rows={2} {...medical.register("chronicConditions")} />,
              )}
              {field(
                "Disabilities",
                <Textarea rows={2} {...medical.register("disabilities")} />,
              )}
              {field(
                "Emergency notes",
                <Textarea rows={2} {...medical.register("emergencyNotes")} />,
              )}
              <p className="text-xs text-muted-foreground md:col-span-2">
                Medical details are visible only to roles holding the
                student.medical.view permission and are excluded from exports.
              </p>
            </div>
          ) : step === 4 ? (
            <DocumentsStep documents={documents} onChange={setDocuments} />
          ) : (
            <ReviewStep
              personal={personal.getValues()}
              className={
                classes.data?.data.find(
                  (c) => c.id === personal.getValues("admissionClassId"),
                )?.name ?? "—"
              }
              guardians={guardians}
              documents={documents}
              duplicates={duplicates}
              checking={checkDuplicates.isPending}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={step === 0 || submit.isPending}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => void next()}>Next</Button>
        ) : (
          <Button
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Registering…" : "Register student"}
          </Button>
        )}
      </div>
    </main>
  );
}

function GuardiansStep({
  guardians,
  onChange,
}: {
  guardians: GuardianEntryValues[];
  onChange: (g: GuardianEntryValues[]) => void;
}) {
  const [searchPhone, setSearchPhone] = useState("");
  const [entry, setEntry] = useState<GuardianEntryValues>(emptyEntry());
  const [existingLabel, setExistingLabel] = useState<string | null>(null);

  function emptyEntry(): GuardianEntryValues {
    return {
      guardianId: "",
      name: "",
      phone: "",
      email: "",
      nid: "",
      occupation: "",
      relation: "FATHER",
      isPrimary: guardians.length === 0,
      isEmergencyContact: guardians.length === 0,
    };
  }

  const search = useMutation({
    mutationFn: (phone: string) => guardiansApi.list({ phone }),
    onSuccess: (res) => {
      const found = res.data[0];
      if (found) {
        setEntry((e) => ({
          ...e,
          guardianId: found.id,
          name: found.name,
          phone: found.phone,
        }));
        setExistingLabel(
          `${found.name} · ${found.phone} — already registered (${found.students.length} child(ren))`,
        );
        toast.success("Existing guardian found — it will be linked, not duplicated.");
      } else {
        setEntry((e) => ({ ...e, guardianId: "", phone: searchPhone }));
        setExistingLabel(null);
        toast.info("No guardian with that phone — fill in the details below.");
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const add = () => {
    const parsed = guardianEntrySchema.safeParse(entry);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Complete the guardian details",
      );
      return;
    }
    onChange([...guardians, parsed.data]);
    setEntry(emptyEntry());
    setSearchPhone("");
    setExistingLabel(null);
  };

  return (
    <div className="space-y-6">
      {guardians.length > 0 ? (
        <div className="space-y-2">
          {guardians.map((g, i) => (
            <div
              key={`${g.guardianId || g.phone}-${i}`}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3"
            >
              <span className="font-medium">{g.name}</span>
              <span className="text-sm text-muted-foreground">
                {GUARDIAN_RELATION_LABELS[g.relation]} · {g.phone}
                {g.guardianId ? " · existing" : ""}
              </span>
              <label className="flex items-center gap-1 text-sm">
                <Checkbox
                  checked={g.isPrimary}
                  onCheckedChange={(checked) =>
                    onChange(
                      guardians.map((row, j) => ({
                        ...row,
                        isPrimary: j === i ? checked === true : false,
                      })),
                    )
                  }
                />
                Primary
              </label>
              <label className="flex items-center gap-1 text-sm">
                <Checkbox
                  checked={g.isEmergencyContact}
                  onCheckedChange={(checked) =>
                    onChange(
                      guardians.map((row, j) =>
                        j === i
                          ? { ...row, isEmergencyContact: checked === true }
                          : row,
                      ),
                    )
                  }
                />
                Emergency
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                onClick={() => onChange(guardians.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add at least one guardian. Siblings share guardian records — search
          by phone first to avoid duplicates.
        </p>
      )}

      <div className="space-y-4 rounded-md border p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label>Search existing guardian by phone</Label>
            <Input
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
            />
          </div>
          <Button
            variant="outline"
            disabled={!/^01[3-9]\d{8}$/.test(searchPhone) || search.isPending}
            onClick={() => search.mutate(searchPhone)}
          >
            Search
          </Button>
        </div>
        {existingLabel ? (
          <p className="text-sm text-emerald-600">{existingLabel}</p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {field(
            "Name",
            <Input
              value={entry.name ?? ""}
              disabled={!!entry.guardianId}
              onChange={(e) => setEntry({ ...entry, name: e.target.value })}
            />,
          )}
          {field(
            "Phone",
            <Input
              value={entry.phone ?? ""}
              disabled={!!entry.guardianId}
              onChange={(e) => setEntry({ ...entry, phone: e.target.value })}
              placeholder="01XXXXXXXXX"
            />,
          )}
          {field(
            "Relation to student",
            <Select
              value={entry.relation}
              onValueChange={(v) =>
                setEntry({ ...entry, relation: v as GuardianRelation })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GUARDIAN_RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {GUARDIAN_RELATION_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>,
          )}
          {field(
            "Occupation",
            <Input
              value={entry.occupation ?? ""}
              disabled={!!entry.guardianId}
              onChange={(e) =>
                setEntry({ ...entry, occupation: e.target.value })
              }
            />,
          )}
          {field(
            "NID",
            <Input
              value={entry.nid ?? ""}
              disabled={!!entry.guardianId}
              onChange={(e) => setEntry({ ...entry, nid: e.target.value })}
            />,
          )}
          {field(
            "Email",
            <Input
              value={entry.email ?? ""}
              disabled={!!entry.guardianId}
              onChange={(e) => setEntry({ ...entry, email: e.target.value })}
            />,
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1 text-sm">
            <Checkbox
              checked={entry.isPrimary}
              onCheckedChange={(checked) =>
                setEntry({ ...entry, isPrimary: checked === true })
              }
            />
            Primary guardian
          </label>
          <label className="flex items-center gap-1 text-sm">
            <Checkbox
              checked={entry.isEmergencyContact}
              onCheckedChange={(checked) =>
                setEntry({ ...entry, isEmergencyContact: checked === true })
              }
            />
            Emergency contact
          </label>
          <Button className="ml-auto" variant="secondary" onClick={add}>
            Add guardian
          </Button>
        </div>
      </div>
    </div>
  );
}

function DocumentsStep({
  documents,
  onChange,
}: {
  documents: QueuedDocument[];
  onChange: (d: QueuedDocument[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<StudentDocumentType>("BIRTH_CERTIFICATE");
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="space-y-4">
      {documents.length > 0 ? (
        <ul className="space-y-2">
          {documents.map((d, i) => (
            <li
              key={`${d.title}-${i}`}
              className="flex items-center gap-3 rounded-md border p-3 text-sm"
            >
              <span className="font-medium">{d.title}</span>
              <span className="text-muted-foreground">
                {d.type} · {d.file.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                onClick={() => onChange(documents.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Optional — queue birth certificate scans, previous marksheets, etc.
          They upload right after registration (PDF/JPG/PNG, ≤10 MB).
        </p>
      )}

      <div className="grid items-end gap-4 md:grid-cols-4">
        {field(
          "Title",
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />,
        )}
        {field(
          "Type",
          <Select
            value={type}
            onValueChange={(v) => setType(v as StudentDocumentType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STUDENT_DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {field(
          "File",
          <Input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />,
        )}
        <Button
          variant="secondary"
          disabled={!title.trim() || !file}
          onClick={() => {
            onChange([...documents, { title: title.trim(), type, file: file! }]);
            setTitle("");
            setFile(null);
          }}
        >
          Queue document
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  personal,
  className,
  guardians,
  documents,
  duplicates,
  checking,
}: {
  personal: StudentPersonalValues;
  className: string;
  guardians: GuardianEntryValues[];
  documents: QueuedDocument[];
  duplicates: DuplicateWarning[] | null;
  checking: boolean;
}) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {checking ? (
        <p className="text-sm text-muted-foreground">
          Checking for possible duplicates…
        </p>
      ) : duplicates && duplicates.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">
            Possible duplicates found (registration is NOT blocked):
          </p>
          <ul className="mt-1 list-inside list-disc">
            {duplicates.map((d) => (
              <li key={d.studentId}>
                {d.name} ({d.studentUid}), born {d.dob} —{" "}
                {d.reason === "NAME_DOB"
                  ? "same name + date of birth"
                  : "same guardian phone + date of birth"}
              </li>
            ))}
          </ul>
        </div>
      ) : duplicates ? (
        <p className="text-sm text-emerald-600">No similar students found.</p>
      ) : null}

      <div className="space-y-1">
        {row("Name", `${personal.firstName} ${personal.lastName}`)}
        {row("Bangla name", personal.nameBn)}
        {row("Gender / DOB", `${personal.gender} · ${personal.dob}`)}
        {row("Religion / Blood", `${personal.religion} · ${personal.bloodGroup || "—"}`)}
        {row("Birth certificate", personal.birthCertificateNo)}
        {row("Admission", `${personal.admissionDate} → ${className}`)}
        {row("Previous school", personal.previousSchool)}
        {row(
          "Guardians",
          guardians
            .map(
              (g) =>
                `${g.name} (${GUARDIAN_RELATION_LABELS[g.relation]}${g.isPrimary ? ", primary" : ""})`,
            )
            .join("; "),
        )}
        {row("Documents queued", String(documents.length))}
      </div>
    </div>
  );
}
