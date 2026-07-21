import { api, ApiEnvelope, PaginationMeta } from "./axios";
import type { Gender, UserStatus } from "./staff";

/** Mirrors the backend student/guardian API shapes (Module 09). */

export type Religion =
  | "ISLAM"
  | "HINDUISM"
  | "BUDDHISM"
  | "CHRISTIANITY"
  | "OTHER";

export type StudentStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "TRANSFERRED"
  | "GRADUATED"
  | "DROPPED"
  | "SUSPENDED";

export type GuardianRelation =
  | "FATHER"
  | "MOTHER"
  | "BROTHER"
  | "SISTER"
  | "UNCLE"
  | "AUNT"
  | "GRANDPARENT"
  | "LEGAL_GUARDIAN"
  | "OTHER";

export type StudentDocumentType =
  | "BIRTH_CERTIFICATE"
  | "PHOTO"
  | "TRANSFER_CERTIFICATE"
  | "PREVIOUS_MARKSHEET"
  | "OTHER";

export const GUARDIAN_RELATION_LABELS: Record<GuardianRelation, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  BROTHER: "Brother",
  SISTER: "Sister",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  LEGAL_GUARDIAN: "Legal Guardian",
  OTHER: "Other",
};

export interface GuardianRef {
  id: string;
  name: string;
  phone: string;
  relation: GuardianRelation;
  userId: string | null;
}

export interface StudentGuardianLink {
  studentId: string;
  guardianId: string;
  relation: GuardianRelation;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  guardian: GuardianRef;
}

export interface Student {
  id: string;
  userId: string | null;
  studentUid: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  gender: Gender;
  dob: string;
  bloodGroup: string | null;
  religion: Religion;
  birthCertificateNo: string | null;
  photoUrl: string | null;
  presentAddress: { present?: string; permanent?: string };
  permanentAddress: { present?: string; permanent?: string };
  admissionDate: string;
  admissionClassId: string | null;
  previousSchool: string | null;
  status: StudentStatus;
  qrToken: string;
  createdAt: string;
  updatedAt: string;
  admissionClass: { id: string; name: string; numericLevel: number } | null;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    status: UserStatus;
    lastLoginAt: string | null;
    mustChangePassword: boolean;
  } | null;
  guardians: StudentGuardianLink[];
}

export interface StudentDetail extends Student {
  photoSignedUrl: string | null;
}

export interface StudentDocument {
  id: string;
  studentId: string;
  title: string;
  type: StudentDocumentType;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl: string;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: StudentStatus;
  toStatus: StudentStatus;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface StudentFull extends StudentDetail {
  documents: Array<Omit<StudentDocument, "signedUrl">>;
  statusHistory: StatusHistoryEntry[];
}

export interface MedicalInfo {
  id?: string;
  studentId: string;
  heightCm: string | number | null;
  weightKg: string | number | null;
  allergies: string | null;
  chronicConditions: string | null;
  disabilities: string | null;
  emergencyNotes: string | null;
}

export interface GuardianEntryInput {
  guardianId?: string;
  name?: string;
  nameBn?: string;
  phone?: string;
  email?: string;
  nid?: string;
  occupation?: string;
  monthlyIncome?: number;
  address?: { present?: string; permanent?: string };
  relation: GuardianRelation;
  isPrimary?: boolean;
  isEmergencyContact?: boolean;
}

export interface StudentInput {
  firstName: string;
  lastName: string;
  nameBn?: string;
  gender: Gender;
  dob: string;
  bloodGroup?: string;
  religion?: Religion;
  birthCertificateNo?: string;
  presentAddress?: { present?: string };
  permanentAddress?: { permanent?: string };
  admissionDate: string;
  admissionClassId: string;
  previousSchool?: string;
  guardians: GuardianEntryInput[];
}

export interface DuplicateWarning {
  studentId: string;
  studentUid: string;
  name: string;
  dob: string;
  reason: "NAME_DOB" | "GUARDIAN_PHONE_DOB";
}

export interface CreateStudentResult {
  student: StudentDetail;
  duplicateWarnings: DuplicateWarning[];
  warnings: string[];
}

export interface StudentListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  classId?: string;
  status?: StudentStatus;
  gender?: Gender;
  religion?: Religion;
}

export interface Guardian {
  id: string;
  userId: string | null;
  name: string;
  nameBn: string | null;
  relation: GuardianRelation;
  phone: string;
  email: string | null;
  nid: string | null;
  occupation: string | null;
  monthlyIncome: string | number | null;
  address: { present?: string; permanent?: string };
  createdAt: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    status: UserStatus;
  } | null;
  students: Array<{
    isPrimary: boolean;
    relation: GuardianRelation;
    student: {
      id: string;
      studentUid: string;
      firstName: string;
      lastName: string;
      status: StudentStatus;
    };
  }>;
}

export interface GuardianInput {
  name: string;
  nameBn?: string;
  relation?: GuardianRelation;
  phone: string;
  email?: string;
  nid?: string;
  occupation?: string;
  monthlyIncome?: number;
  address?: { present?: string; permanent?: string };
}

export interface AccountCreatedResult {
  userId: string;
  phone: string | null;
  email: string | null;
  tempPassword: string;
}

export interface ImportRowResult {
  row: number;
  status: "VALID" | "ERROR" | "IMPORTED";
  studentUid?: string;
  errors: string[];
  warnings: string[];
}

/** `GET /students/:id/attendance-history` — live since M12. */
export interface StudentAttendanceHistory {
  available: boolean;
  reason?: string;
  counts: Record<string, number>;
  markedDays: number;
  presentEquivalent: number;
  percentage: number;
  items: Array<{
    date: string;
    status: string;
    sectionId: string;
    remarks: string | null;
  }>;
}

export interface ImportReport {
  total: number;
  valid: number;
  invalid: number;
  imported: number;
  committed: boolean;
  rows: ImportRowResult[];
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Trigger a browser download from a binary API response. */
const saveBlob = (data: Blob, filename: string) => {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const studentsApi = {
  async list(
    query: StudentListQuery = {},
  ): Promise<{ data: Student[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<Student[]>>("/students", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<StudentDetail> {
    const res = await api.get<ApiEnvelope<StudentDetail>>(`/students/${id}`);
    return res.data.data;
  },

  async getFull(id: string): Promise<StudentFull> {
    const res = await api.get<ApiEnvelope<StudentFull>>(
      `/students/${id}/full`,
    );
    return res.data.data;
  },

  async create(input: StudentInput): Promise<CreateStudentResult> {
    const res = await api.post<ApiEnvelope<CreateStudentResult>>(
      "/students",
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<Omit<StudentInput, "guardians">>,
  ): Promise<StudentDetail> {
    const res = await api.put<ApiEnvelope<StudentDetail>>(
      `/students/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/students/${id}`);
  },

  async updateStatus(
    id: string,
    input: { status: StudentStatus; reason: string },
  ): Promise<{ student: StudentDetail; warnings: string[] }> {
    const res = await api.put<
      ApiEnvelope<{ student: StudentDetail; warnings: string[] }>
    >(`/students/${id}/status`, input);
    return res.data.data;
  },

  async uploadPhoto(id: string, file: File): Promise<StudentDetail> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<StudentDetail>>(
      `/students/${id}/photo`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async rotateQr(id: string): Promise<StudentDetail> {
    const res = await api.post<ApiEnvelope<StudentDetail>>(
      `/students/${id}/rotate-qr`,
    );
    return res.data.data;
  },

  async checkDuplicates(input: {
    firstName: string;
    lastName: string;
    dob: string;
    guardianPhones?: string[];
  }): Promise<DuplicateWarning[]> {
    const res = await api.post<ApiEnvelope<DuplicateWarning[]>>(
      "/students/check-duplicates",
      input,
    );
    return res.data.data;
  },

  // ── guardians ───────────────────────────────────────────────────

  async linkGuardian(
    id: string,
    input: {
      guardianId: string;
      relation: GuardianRelation;
      isPrimary?: boolean;
      isEmergencyContact?: boolean;
    },
  ): Promise<StudentGuardianLink[]> {
    const res = await api.post<ApiEnvelope<StudentGuardianLink[]>>(
      `/students/${id}/guardians`,
      input,
    );
    return res.data.data;
  },

  async updateGuardianLink(
    id: string,
    guardianId: string,
    input: {
      relation?: GuardianRelation;
      isPrimary?: boolean;
      isEmergencyContact?: boolean;
    },
  ): Promise<StudentGuardianLink[]> {
    const res = await api.put<ApiEnvelope<StudentGuardianLink[]>>(
      `/students/${id}/guardians/${guardianId}`,
      input,
    );
    return res.data.data;
  },

  async unlinkGuardian(
    id: string,
    guardianId: string,
  ): Promise<StudentGuardianLink[]> {
    const res = await api.delete<ApiEnvelope<StudentGuardianLink[]>>(
      `/students/${id}/guardians/${guardianId}`,
    );
    return res.data.data;
  },

  // ── medical / documents ─────────────────────────────────────────

  async getMedical(id: string): Promise<MedicalInfo> {
    const res = await api.get<ApiEnvelope<MedicalInfo>>(
      `/students/${id}/medical`,
    );
    return res.data.data;
  },

  async updateMedical(
    id: string,
    input: Partial<{
      heightCm: number;
      weightKg: number;
      allergies: string;
      chronicConditions: string;
      disabilities: string;
      emergencyNotes: string;
    }>,
  ): Promise<MedicalInfo> {
    const res = await api.put<ApiEnvelope<MedicalInfo>>(
      `/students/${id}/medical`,
      input,
    );
    return res.data.data;
  },

  async listDocuments(id: string): Promise<StudentDocument[]> {
    const res = await api.get<ApiEnvelope<StudentDocument[]>>(
      `/students/${id}/documents`,
    );
    return res.data.data;
  },

  async uploadDocument(
    id: string,
    input: { title: string; type: StudentDocumentType; file: File },
  ): Promise<StudentDocument> {
    const form = new FormData();
    form.append("file", input.file);
    form.append("title", input.title);
    form.append("type", input.type);
    const res = await api.post<ApiEnvelope<StudentDocument>>(
      `/students/${id}/documents`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async removeDocument(id: string, docId: string): Promise<void> {
    await api.delete(`/students/${id}/documents/${docId}`);
  },

  // ── accounts / ID cards / import / history ──────────────────────

  async createAccount(
    id: string,
    input: { phone?: string; email?: string },
  ): Promise<AccountCreatedResult> {
    const res = await api.post<ApiEnvelope<AccountCreatedResult>>(
      `/students/${id}/create-account`,
      input,
    );
    return res.data.data;
  },

  /** Downloads the PDF; returns how many cards lack a photo. */
  async downloadIdCard(id: string, uid: string): Promise<number> {
    const res = await api.post<Blob>(`/students/${id}/id-card`, undefined, {
      responseType: "blob",
    });
    saveBlob(res.data, `id-card-${uid}.pdf`);
    return Number(res.headers["x-cards-incomplete"] ?? 0);
  },

  async downloadIdCards(studentIds: string[]): Promise<number> {
    const res = await api.post<Blob>(
      "/students/id-cards",
      { studentIds },
      { responseType: "blob" },
    );
    saveBlob(res.data, "id-cards.pdf");
    return Number(res.headers["x-cards-incomplete"] ?? 0);
  },

  async downloadImportTemplate(): Promise<void> {
    const res = await api.get<Blob>("/students/import-template", {
      responseType: "blob",
    });
    saveBlob(res.data, "hexschool-students-import.xlsx");
  },

  async import(file: File, commit: boolean): Promise<ImportReport> {
    const form = new FormData();
    form.append("file", file);
    form.append("commit", String(commit));
    const res = await api.post<ApiEnvelope<ImportReport>>(
      "/students/import",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  /** Live since M12 — `counts`/`percentage` are over MARKED days; the
   *  working-day denominator lives on the attendance report endpoint. */
  async attendanceHistory(id: string): Promise<StudentAttendanceHistory> {
    const res = await api.get<ApiEnvelope<StudentAttendanceHistory>>(
      `/students/${id}/attendance-history`,
    );
    return res.data.data;
  },

  async performanceHistory(
    id: string,
  ): Promise<{ available: boolean; reason?: string; items: unknown[] }> {
    const res = await api.get<
      ApiEnvelope<{ available: boolean; reason?: string; items: unknown[] }>
    >(`/students/${id}/performance-history`);
    return res.data.data;
  },
};

export const guardiansApi = {
  async list(
    query: {
      page?: number;
      limit?: number;
      sort?: string;
      search?: string;
      phone?: string;
    } = {},
  ): Promise<{ data: Guardian[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<Guardian[]>>("/guardians", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<Guardian> {
    const res = await api.get<ApiEnvelope<Guardian>>(`/guardians/${id}`);
    return res.data.data;
  },

  async create(input: GuardianInput): Promise<Guardian> {
    const res = await api.post<ApiEnvelope<Guardian>>("/guardians", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<GuardianInput>): Promise<Guardian> {
    const res = await api.put<ApiEnvelope<Guardian>>(`/guardians/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/guardians/${id}`);
  },

  async createAccount(
    id: string,
    input: { phone?: string; email?: string } = {},
  ): Promise<AccountCreatedResult> {
    const res = await api.post<ApiEnvelope<AccountCreatedResult>>(
      `/guardians/${id}/create-account`,
      input,
    );
    return res.data.data;
  },
};
