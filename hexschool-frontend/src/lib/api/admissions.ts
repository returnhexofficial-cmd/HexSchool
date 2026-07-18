import { api, ApiEnvelope, PaginationMeta } from "./axios";
import type { Gender } from "./staff";
import type { GuardianRelation, Religion } from "./students";

/** Mirrors the backend admission API shapes (Module 10). */

export type AdmissionCycleStatus = "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";

export type AdmissionApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "PAYMENT_PENDING"
  | "UNDER_REVIEW"
  | "TEST_SCHEDULED"
  | "PASSED"
  | "FAILED"
  | "SELECTED"
  | "WAITLISTED"
  | "ADMITTED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export type AdmissionPaymentStatus = "UNPAID" | "PAID" | "WAIVED" | "REFUNDED";

export const APPLICATION_STATUS_LABELS: Record<
  AdmissionApplicationStatus,
  string
> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PAYMENT_PENDING: "Payment Pending",
  UNDER_REVIEW: "Under Review",
  TEST_SCHEDULED: "Test Scheduled",
  PASSED: "Passed",
  FAILED: "Failed",
  SELECTED: "Selected",
  WAITLISTED: "Waitlisted",
  ADMITTED: "Admitted",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export interface AdmissionCycleClass {
  id: string;
  cycleId: string;
  classId: string;
  seats: number;
  applicationFee: string | number;
  class: { id: string; name: string; numericLevel: number };
}

export interface AdmissionTest {
  id: string;
  cycleId: string;
  classId: string;
  testDate: string;
  venue: string | null;
  totalMarks: number;
  passMarks: number;
}

export interface AdmissionCycle {
  id: string;
  sessionId: string;
  name: string;
  startAt: string;
  endAt: string;
  testRequired: boolean;
  status: AdmissionCycleStatus;
  instructions: string | null;
  createdAt: string;
  session: { id: string; name: string };
  classes: AdmissionCycleClass[];
  tests: AdmissionTest[];
}

export interface AdmissionApplication {
  id: string;
  cycleId: string;
  applicationNo: string;
  classId: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  gender: Gender;
  dob: string;
  religion: Religion;
  photoUrl: string | null;
  presentAddress: { present?: string; permanent?: string };
  permanentAddress: { present?: string; permanent?: string };
  previousSchool: string | null;
  previousGpa: string | number | null;
  previousResult: Record<string, unknown>;
  guardian: {
    name: string;
    nameBn?: string;
    relation: GuardianRelation;
    phone: string;
    email?: string;
    occupation?: string;
  };
  phone: string;
  status: AdmissionApplicationStatus;
  paymentStatus: AdmissionPaymentStatus;
  paymentRef: string | null;
  paymentMethod: string | null;
  paidAmount: string | number | null;
  paidAt: string | null;
  testMarks: string | number | null;
  meritPosition: number | null;
  admissionDeadline: string | null;
  studentId: string | null;
  createdAt: string;
  class: { id: string; name: string; numericLevel: number };
  cycle: {
    id: string;
    name: string;
    testRequired: boolean;
    status: AdmissionCycleStatus;
  };
  student: { id: string; studentUid: string } | null;
}

export interface CycleClassInput {
  classId: string;
  seats: number;
  applicationFee?: number;
}

export interface CycleInput {
  sessionId: string;
  name: string;
  startAt: string;
  endAt: string;
  testRequired?: boolean;
  instructions?: string;
  classes: CycleClassInput[];
}

export interface CycleListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sessionId?: string;
  status?: AdmissionCycleStatus;
}

export interface ApplicationListQuery {
  page?: number;
  limit?: number;
  search?: string;
  cycleId?: string;
  classId?: string;
  status?: AdmissionApplicationStatus;
  paymentStatus?: AdmissionPaymentStatus;
}

export interface MeritGenerationResult {
  classId: string;
  seats: number;
  alreadyAdmitted: number;
  selected: number;
  waitlisted: number;
  regenerated: boolean;
}

export interface AdmissionSummary {
  funnel: {
    applied: number;
    processed: number;
    selected: number;
    admitted: number;
    waitlisted: number;
  };
  byStatus: Partial<Record<AdmissionApplicationStatus, number>>;
  classes: Array<{
    classId: string;
    className: string;
    seats: number;
    applicationFee: number;
    applied: number;
    paymentPending: number;
    testScheduled: number;
    passed: number;
    failed: number;
    selected: number;
    waitlisted: number;
    admitted: number;
    feesCollected: number;
  }>;
}

/** Public (unauthenticated) portal shapes. */
export interface PublicCycle {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  testRequired: boolean;
  instructions: string | null;
  session: { id: string; name: string };
  classes: Array<{
    classId: string;
    className: string;
    numericLevel: number;
    seats: number;
    applicationFee: number;
  }>;
  tests: AdmissionTest[];
}

export interface PublicApplyInput {
  verificationToken: string;
  cycleId: string;
  classId: string;
  firstName: string;
  lastName: string;
  nameBn?: string;
  gender: Gender;
  dob: string;
  religion?: Religion;
  presentAddress?: { present?: string; permanent?: string };
  permanentAddress?: { present?: string; permanent?: string };
  previousSchool?: string;
  previousGpa?: number;
  previousResult?: Record<string, unknown>;
  guardian: {
    name: string;
    nameBn?: string;
    relation: GuardianRelation;
    phone: string;
    email?: string;
    occupation?: string;
  };
  photoKey?: string;
  recaptchaToken?: string;
}

export interface TrackResult {
  applicationNo: string;
  applicantName: string;
  cycleName: string;
  className: string;
  status: AdmissionApplicationStatus;
  paymentStatus: AdmissionPaymentStatus;
  applicationFee: number;
  testRequired: boolean;
  test: { date: string; venue: string | null; totalMarks: number } | null;
  testMarks: number | null;
  meritPosition: number | null;
  admissionDeadline: string | null;
  studentUid: string | null;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

const saveBlob = (data: Blob, filename: string) => {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const admissionCyclesApi = {
  async list(
    query: CycleListQuery = {},
  ): Promise<{ data: AdmissionCycle[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<AdmissionCycle[]>>(
      "/admission-cycles",
      { params: params(query) },
    );
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<AdmissionCycle> {
    const res = await api.get<ApiEnvelope<AdmissionCycle>>(
      `/admission-cycles/${id}`,
    );
    return res.data.data;
  },

  async create(input: CycleInput): Promise<AdmissionCycle> {
    const res = await api.post<ApiEnvelope<AdmissionCycle>>(
      "/admission-cycles",
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<CycleInput>,
  ): Promise<AdmissionCycle> {
    const res = await api.put<ApiEnvelope<AdmissionCycle>>(
      `/admission-cycles/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/admission-cycles/${id}`);
  },

  async open(id: string): Promise<AdmissionCycle> {
    const res = await api.post<ApiEnvelope<AdmissionCycle>>(
      `/admission-cycles/${id}/open`,
    );
    return res.data.data;
  },

  async close(id: string): Promise<AdmissionCycle> {
    const res = await api.post<ApiEnvelope<AdmissionCycle>>(
      `/admission-cycles/${id}/close`,
    );
    return res.data.data;
  },

  async complete(id: string): Promise<AdmissionCycle> {
    const res = await api.post<ApiEnvelope<AdmissionCycle>>(
      `/admission-cycles/${id}/complete`,
    );
    return res.data.data;
  },

  async scheduleTests(
    id: string,
    tests: Array<{
      classId: string;
      testDate: string;
      venue?: string;
      totalMarks: number;
      passMarks: number;
    }>,
  ): Promise<AdmissionTest[]> {
    const res = await api.put<ApiEnvelope<AdmissionTest[]>>(
      `/admission-cycles/${id}/tests`,
      { tests },
    );
    return res.data.data;
  },

  async enterMarks(
    id: string,
    entries: Array<{ applicationId: string; marks: number }>,
  ): Promise<{ graded: number; passed: number; failed: number }> {
    const res = await api.post<
      ApiEnvelope<{ graded: number; passed: number; failed: number }>
    >(`/admission-cycles/${id}/test-marks`, { entries });
    return res.data.data;
  },

  async generateMeritList(
    id: string,
    classId: string,
  ): Promise<MeritGenerationResult> {
    const res = await api.post<ApiEnvelope<MeritGenerationResult>>(
      `/admission-cycles/${id}/generate-merit-list`,
      { classId },
    );
    return res.data.data;
  },

  async meritList(
    id: string,
    classId: string,
  ): Promise<AdmissionApplication[]> {
    const res = await api.get<ApiEnvelope<AdmissionApplication[]>>(
      `/admission-cycles/${id}/merit-list`,
      { params: { classId } },
    );
    return res.data.data;
  },

  async waitingList(
    id: string,
    classId: string,
  ): Promise<AdmissionApplication[]> {
    const res = await api.get<ApiEnvelope<AdmissionApplication[]>>(
      `/admission-cycles/${id}/waiting-list`,
      { params: { classId } },
    );
    return res.data.data;
  },

  async promoteWaitlist(
    id: string,
    classId: string,
    count = 1,
  ): Promise<AdmissionApplication[]> {
    const res = await api.post<ApiEnvelope<AdmissionApplication[]>>(
      `/admission-cycles/${id}/promote-waitlist`,
      { classId, count },
    );
    return res.data.data;
  },
};

export const admissionApplicationsApi = {
  async list(
    query: ApplicationListQuery = {},
  ): Promise<{ data: AdmissionApplication[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<AdmissionApplication[]>>(
      "/admission-applications",
      { params: params(query) },
    );
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<AdmissionApplication> {
    const res = await api.get<ApiEnvelope<AdmissionApplication>>(
      `/admission-applications/${id}`,
    );
    return res.data.data;
  },

  async updateStatus(
    id: string,
    status: AdmissionApplicationStatus,
    reason?: string,
  ): Promise<AdmissionApplication> {
    const res = await api.put<ApiEnvelope<AdmissionApplication>>(
      `/admission-applications/${id}/status`,
      { status, reason },
    );
    return res.data.data;
  },

  async recordPayment(
    id: string,
    input: { method: string; reference?: string; amount?: number },
  ): Promise<AdmissionApplication> {
    const res = await api.post<ApiEnvelope<AdmissionApplication>>(
      `/admission-applications/${id}/payment`,
      input,
    );
    return res.data.data;
  },

  async setPaymentStatus(
    id: string,
    status: "WAIVED" | "REFUNDED",
    reason: string,
  ): Promise<AdmissionApplication> {
    const res = await api.put<ApiEnvelope<AdmissionApplication>>(
      `/admission-applications/${id}/payment-status`,
      { status, reason },
    );
    return res.data.data;
  },

  async admit(id: string): Promise<{
    student: { id: string; studentUid: string };
    alreadyAdmitted: boolean;
    warnings: string[];
    duplicateWarnings: unknown[];
  }> {
    const res = await api.post<
      ApiEnvelope<{
        student: { id: string; studentUid: string };
        alreadyAdmitted: boolean;
        warnings: string[];
        duplicateWarnings: unknown[];
      }>
    >(`/admission-applications/${id}/admit`);
    return res.data.data;
  },

  async downloadAdmitCard(id: string, appNo: string): Promise<void> {
    const res = await api.get<Blob>(
      `/admission-applications/${id}/admit-card`,
      { responseType: "blob" },
    );
    saveBlob(res.data, `admit-card-${appNo}.pdf`);
  },
};

export const admissionReportsApi = {
  async summary(cycleId?: string): Promise<AdmissionSummary> {
    const res = await api.get<ApiEnvelope<AdmissionSummary>>(
      "/admission-reports/summary",
      { params: params({ cycleId }) },
    );
    return res.data.data;
  },
};

export const admissionPublicApi = {
  async cycles(): Promise<PublicCycle[]> {
    const res = await api.get<ApiEnvelope<PublicCycle[]>>(
      "/public/admissions/cycles",
    );
    return res.data.data;
  },

  async requestOtp(phone: string, recaptchaToken?: string): Promise<void> {
    await api.post("/public/admissions/request-otp", {
      phone,
      recaptchaToken,
    });
  },

  async verifyOtp(
    phone: string,
    code: string,
  ): Promise<{ verificationToken: string }> {
    const res = await api.post<ApiEnvelope<{ verificationToken: string }>>(
      "/public/admissions/verify-otp",
      { phone, code },
    );
    return res.data.data;
  },

  async uploadPhoto(
    verificationToken: string,
    file: File,
  ): Promise<{ photoKey: string }> {
    const form = new FormData();
    form.append("file", file);
    form.append("verificationToken", verificationToken);
    const res = await api.post<ApiEnvelope<{ photoKey: string }>>(
      "/public/admissions/photo",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async apply(input: PublicApplyInput): Promise<{
    applicationNo: string;
    status: AdmissionApplicationStatus;
    applicationFee: number;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        applicationNo: string;
        status: AdmissionApplicationStatus;
        applicationFee: number;
      }>
    >("/public/admissions/apply", input);
    return res.data.data;
  },

  async track(appNo: string, phone: string): Promise<TrackResult> {
    const res = await api.get<ApiEnvelope<TrackResult>>(
      "/public/admissions/track",
      { params: { appNo, phone } },
    );
    return res.data.data;
  },

  async downloadAdmitCard(appNo: string, phone: string): Promise<void> {
    const res = await api.get<Blob>("/public/admissions/admit-card", {
      params: { appNo, phone },
      responseType: "blob",
    });
    saveBlob(res.data, `admit-card-${appNo}.pdf`);
  },
};
