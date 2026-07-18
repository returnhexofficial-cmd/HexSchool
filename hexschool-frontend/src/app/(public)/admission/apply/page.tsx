"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  admissionPublicApi,
  type PublicCycle,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { GUARDIAN_RELATION_LABELS } from "@/lib/api/students";
import { getRecaptchaToken } from "@/lib/utils/recaptcha";
import {
  applyApplicantSchema,
  applyGuardianSchema,
  applyOtpSchema,
  applyPhoneSchema,
  GUARDIAN_RELATIONS,
  RELIGIONS,
  type ApplyApplicantValues,
  type ApplyGuardianValues,
  type ApplyOtpValues,
  type ApplyPhoneValues,
} from "@/lib/validations/admission";

const STEPS = ["Verify phone", "Applicant", "Guardian", "Review"] as const;

/** Draft persisted locally so an interrupted applicant can resume
 *  (server-side drafts are a known M10 limitation). */
const DRAFT_KEY = "hs_admission_draft";

interface Draft {
  applicant?: ApplyApplicantValues;
  guardian?: ApplyGuardianValues;
}

const loadDraft = (): Draft => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Draft;
  } catch {
    return {};
  }
};

export default function AdmissionApplyPage() {
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    applicationNo: string;
    status: string;
    applicationFee: number;
  } | null>(null);

  const draft = useMemo(loadDraft, []);

  const cycles = useQuery({
    queryKey: ["public-admission-cycles"],
    queryFn: () => admissionPublicApi.cycles(),
  });

  const phoneForm = useForm<ApplyPhoneValues>({
    resolver: zodResolver(applyPhoneSchema),
    defaultValues: { phone: "" },
  });
  const otpForm = useForm<ApplyOtpValues>({
    resolver: zodResolver(applyOtpSchema),
    defaultValues: { code: "" },
  });
  const applicantForm = useForm<ApplyApplicantValues>({
    resolver: zodResolver(applyApplicantSchema),
    defaultValues: draft.applicant ?? {
      cycleId: "",
      classId: "",
      firstName: "",
      lastName: "",
      nameBn: "",
      gender: "MALE",
      dob: "",
      religion: "ISLAM",
      presentAddress: "",
      previousSchool: "",
      previousGpa: "",
    },
  });
  const guardianForm = useForm<ApplyGuardianValues>({
    resolver: zodResolver(applyGuardianSchema),
    defaultValues: draft.guardian ?? {
      name: "",
      nameBn: "",
      relation: "FATHER",
      phone: "",
      email: "",
      occupation: "",
    },
  });

  // Persist the draft as the applicant types (resume after interruption).
  useEffect(() => {
    const save = () => {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          applicant: applicantForm.getValues(),
          guardian: guardianForm.getValues(),
        } satisfies Draft),
      );
    };
    const subA = applicantForm.watch(save);
    const subG = guardianForm.watch(save);
    return () => {
      subA.unsubscribe();
      subG.unsubscribe();
    };
  }, [applicantForm, guardianForm]);

  const requestOtp = useMutation({
    mutationFn: async (values: ApplyPhoneValues) => {
      const recaptchaToken = await getRecaptchaToken("admission_otp");
      await admissionPublicApi.requestOtp(values.phone, recaptchaToken);
      return values.phone;
    },
    onSuccess: (sentPhone) => {
      setPhone(sentPhone);
      setOtpSent(true);
      toast.success("Verification code sent by SMS.");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const verifyOtp = useMutation({
    mutationFn: (values: ApplyOtpValues) =>
      admissionPublicApi.verifyOtp(phone, values.code),
    onSuccess: (res) => {
      setVerificationToken(res.verificationToken);
      setStep(1);
      toast.success("Phone verified.");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const applicant = applicantForm.getValues();
      const guardian = guardianForm.getValues();

      let photoKey: string | undefined;
      if (photoFile) {
        photoKey = (
          await admissionPublicApi.uploadPhoto(verificationToken, photoFile)
        ).photoKey;
      }
      const recaptchaToken = await getRecaptchaToken("admission_apply");
      return admissionPublicApi.apply({
        verificationToken,
        cycleId: applicant.cycleId,
        classId: applicant.classId,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        nameBn: applicant.nameBn || undefined,
        gender: applicant.gender,
        dob: applicant.dob,
        religion: applicant.religion,
        presentAddress: applicant.presentAddress
          ? { present: applicant.presentAddress }
          : undefined,
        previousSchool: applicant.previousSchool || undefined,
        previousGpa: applicant.previousGpa
          ? Number(applicant.previousGpa)
          : undefined,
        guardian: {
          name: guardian.name,
          nameBn: guardian.nameBn || undefined,
          relation: guardian.relation,
          phone: guardian.phone,
          email: guardian.email || undefined,
          occupation: guardian.occupation || undefined,
        },
        photoKey,
        recaptchaToken,
      });
    },
    onSuccess: (res) => {
      localStorage.removeItem(DRAFT_KEY);
      setResult(res);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const selectedCycle: PublicCycle | undefined = cycles.data?.find(
    (c) => c.id === applicantForm.watch("cycleId"),
  );
  const selectedClass = selectedCycle?.classes.find(
    (c) => c.classId === applicantForm.watch("classId"),
  );

  if (result) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 p-4 sm:p-8">
        <Card>
          <CardHeader>
            <CardTitle>Application received 🎉</CardTitle>
            <CardDescription>
              Save your application number — you need it (with your phone
              number) to track the application and download the admit card.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Application Number
              </p>
              <p className="text-2xl font-bold tracking-wide">
                {result.applicationNo}
              </p>
            </div>
            {result.status === "PAYMENT_PENDING" ? (
              <p className="text-sm">
                <strong>Application fee due:</strong> BDT{" "}
                {result.applicationFee.toFixed(2)}. Pay at the school office
                (online payment arrives soon) to confirm your application.
              </p>
            ) : (
              <p className="text-sm">
                No application fee is due. Your application is submitted.
              </p>
            )}
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/admission/track">Track application</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/admission">Back to admissions</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const fieldError = (msg?: string) =>
    msg ? <p className="text-sm text-destructive">{msg}</p> : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admission Application
        </h1>
        <div className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <Badge key={label} variant={i === step ? "default" : "outline"}>
              {i + 1}. {label}
            </Badge>
          ))}
        </div>
      </div>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Verify your phone</CardTitle>
            <CardDescription>
              We send a 6-digit code by SMS. This number receives all updates
              about the application.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!otpSent ? (
              <FormProvider {...phoneForm}>
                <form
                  className="space-y-4"
                  onSubmit={phoneForm.handleSubmit((v) =>
                    requestOtp.mutate(v),
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="apply-phone">Mobile number</Label>
                    <Input
                      id="apply-phone"
                      placeholder="01XXXXXXXXX"
                      inputMode="numeric"
                      {...phoneForm.register("phone")}
                    />
                    {fieldError(phoneForm.formState.errors.phone?.message)}
                  </div>
                  <Button type="submit" disabled={requestOtp.isPending}>
                    {requestOtp.isPending ? <Spinner /> : "Send code"}
                  </Button>
                </form>
              </FormProvider>
            ) : (
              <FormProvider {...otpForm}>
                <form
                  className="space-y-4"
                  onSubmit={otpForm.handleSubmit((v) => verifyOtp.mutate(v))}
                >
                  <p className="text-sm text-muted-foreground">
                    Code sent to <strong>{phone}</strong>.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="apply-otp">6-digit code</Label>
                    <Input
                      id="apply-otp"
                      inputMode="numeric"
                      maxLength={6}
                      {...otpForm.register("code")}
                    />
                    {fieldError(otpForm.formState.errors.code?.message)}
                  </div>
                  <div className="flex gap-3">
                    <Button type="submit" disabled={verifyOtp.isPending}>
                      {verifyOtp.isPending ? <Spinner /> : "Verify"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={requestOtp.isPending}
                      onClick={() => requestOtp.mutate({ phone })}
                    >
                      Resend
                    </Button>
                  </div>
                </form>
              </FormProvider>
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Applicant details</CardTitle>
          </CardHeader>
          <CardContent>
            <FormProvider {...applicantForm}>
              <form
                className="space-y-4"
                onSubmit={applicantForm.handleSubmit(() => setStep(2))}
              >
                <div className="space-y-2">
                  <Label>Admission cycle</Label>
                  <Select
                    value={applicantForm.watch("cycleId")}
                    onValueChange={(v) => {
                      applicantForm.setValue("cycleId", v, {
                        shouldValidate: true,
                      });
                      applicantForm.setValue("classId", "");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          cycles.isPending ? "Loading…" : "Pick a cycle"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(cycles.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.session.name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError(
                    applicantForm.formState.errors.cycleId?.message,
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Applying for class</Label>
                  <Select
                    value={applicantForm.watch("classId")}
                    onValueChange={(v) =>
                      applicantForm.setValue("classId", v, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a class" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedCycle?.classes ?? []).map((c) => (
                        <SelectItem key={c.classId} value={c.classId}>
                          {c.className}
                          {c.applicationFee > 0
                            ? ` — fee BDT ${c.applicationFee.toFixed(2)}`
                            : " — free"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError(
                    applicantForm.formState.errors.classId?.message,
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="a-first">First name</Label>
                    <Input
                      id="a-first"
                      {...applicantForm.register("firstName")}
                    />
                    {fieldError(
                      applicantForm.formState.errors.firstName?.message,
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="a-last">Last name</Label>
                    <Input
                      id="a-last"
                      {...applicantForm.register("lastName")}
                    />
                    {fieldError(
                      applicantForm.formState.errors.lastName?.message,
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="a-bn">Name in Bangla (optional)</Label>
                  <Input id="a-bn" {...applicantForm.register("nameBn")} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Gender</Label>
                    <Select
                      value={applicantForm.watch("gender")}
                      onValueChange={(v) =>
                        applicantForm.setValue(
                          "gender",
                          v as ApplyApplicantValues["gender"],
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["MALE", "FEMALE", "OTHER"] as const).map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="a-dob">Date of birth</Label>
                    <Input
                      id="a-dob"
                      type="date"
                      {...applicantForm.register("dob")}
                    />
                    {fieldError(applicantForm.formState.errors.dob?.message)}
                  </div>
                  <div className="space-y-2">
                    <Label>Religion</Label>
                    <Select
                      value={applicantForm.watch("religion")}
                      onValueChange={(v) =>
                        applicantForm.setValue(
                          "religion",
                          v as ApplyApplicantValues["religion"],
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
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="a-address">Present address</Label>
                  <Input
                    id="a-address"
                    {...applicantForm.register("presentAddress")}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="a-prev">Previous school (optional)</Label>
                    <Input
                      id="a-prev"
                      {...applicantForm.register("previousSchool")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="a-gpa">Last result GPA (optional)</Label>
                    <Input
                      id="a-gpa"
                      placeholder="e.g. 4.50"
                      {...applicantForm.register("previousGpa")}
                    />
                    {fieldError(
                      applicantForm.formState.errors.previousGpa?.message,
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit">Next: guardian</Button>
                </div>
              </form>
            </FormProvider>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Guardian details</CardTitle>
            <CardDescription>
              The guardian becomes the primary contact if the applicant is
              admitted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormProvider {...guardianForm}>
              <form
                className="space-y-4"
                onSubmit={guardianForm.handleSubmit(() => setStep(3))}
              >
                <div className="space-y-2">
                  <Label htmlFor="g-name">Guardian name</Label>
                  <Input id="g-name" {...guardianForm.register("name")} />
                  {fieldError(guardianForm.formState.errors.name?.message)}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Relation</Label>
                    <Select
                      value={guardianForm.watch("relation")}
                      onValueChange={(v) =>
                        guardianForm.setValue(
                          "relation",
                          v as ApplyGuardianValues["relation"],
                        )
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
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="g-phone">Guardian phone</Label>
                    <Input
                      id="g-phone"
                      inputMode="numeric"
                      placeholder="01XXXXXXXXX"
                      {...guardianForm.register("phone")}
                    />
                    {fieldError(
                      guardianForm.formState.errors.phone?.message,
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="g-email">Email (optional)</Label>
                    <Input id="g-email" {...guardianForm.register("email")} />
                    {fieldError(
                      guardianForm.formState.errors.email?.message,
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="g-occ">Occupation (optional)</Label>
                    <Input
                      id="g-occ"
                      {...guardianForm.register("occupation")}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="g-photo">
                    Applicant photo (optional, JPG/PNG ≤ 1 MB)
                  </Label>
                  <Input
                    id="g-photo"
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={(e) =>
                      setPhotoFile(e.target.files?.[0] ?? null)
                    }
                  />
                </div>

                <div className="flex justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                  >
                    Back
                  </Button>
                  <Button type="submit">Next: review</Button>
                </div>
              </form>
            </FormProvider>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review &amp; submit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Cycle</dt>
              <dd>{selectedCycle?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Class</dt>
              <dd>{selectedClass?.className ?? "—"}</dd>
              <dt className="text-muted-foreground">Applicant</dt>
              <dd>
                {applicantForm.watch("firstName")}{" "}
                {applicantForm.watch("lastName")} ·{" "}
                {applicantForm.watch("gender")} · born{" "}
                {applicantForm.watch("dob")}
              </dd>
              <dt className="text-muted-foreground">Guardian</dt>
              <dd>
                {guardianForm.watch("name")} (
                {GUARDIAN_RELATION_LABELS[guardianForm.watch("relation")]}) ·{" "}
                {guardianForm.watch("phone")}
              </dd>
              <dt className="text-muted-foreground">Contact phone</dt>
              <dd>{phone}</dd>
              <dt className="text-muted-foreground">Photo</dt>
              <dd>{photoFile ? photoFile.name : "Not attached"}</dd>
              <dt className="text-muted-foreground">Application fee</dt>
              <dd>
                {selectedClass && selectedClass.applicationFee > 0
                  ? `BDT ${selectedClass.applicationFee.toFixed(2)} (pay at the school office after submitting)`
                  : "Free"}
              </dd>
            </dl>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                disabled={submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? <Spinner /> : "Submit application"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
