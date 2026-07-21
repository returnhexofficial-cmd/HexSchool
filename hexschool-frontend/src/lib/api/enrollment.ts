import { api, ApiEnvelope, PaginationMeta } from "./axios";
import type { Gender } from "./staff";

/** Mirrors the backend enrollment/promotion API shapes (Module 11). */

export type EnrollmentType =
  | "NEW"
  | "PROMOTED"
  | "READMITTED"
  | "TRANSFERRED_IN";

export type EnrollmentStatus =
  | "ACTIVE"
  | "TRANSFERRED_OUT"
  | "PROMOTED"
  | "RETAINED"
  | "COMPLETED"
  | "CANCELLED";

export type RollStrategy = "NEXT" | "ALPHABETICAL";
export type RenumberStrategy = "SEQUENTIAL" | "ALPHABETICAL";

export type PromotionBatchStatus = "DRAFT" | "EXECUTED" | "ROLLED_BACK";
export type PromotionDecision = "PROMOTE" | "RETAIN" | "GRADUATE" | "EXCLUDE";

export interface EnrollmentStudentRef {
  id: string;
  studentUid: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  photoUrl: string | null;
  gender: Gender;
  status: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  sessionId: string;
  classId: string;
  sectionId: string;
  groupId: string | null;
  shiftId: string | null;
  rollNo: number;
  enrollmentDate: string;
  type: EnrollmentType;
  status: EnrollmentStatus;
  optionalSubjectId: string | null;
  student: EnrollmentStudentRef;
  section: { id: string; name: string };
  class: { id: string; name: string; numericLevel: number };
  group: { id: string; name: string } | null;
  shift: { id: string; name: string } | null;
  optionalSubject: { id: string; name: string; code: string } | null;
  session: { id: string; name: string };
}

export interface EnrollableStudent {
  id: string;
  studentUid: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  gender: Gender;
  photoUrl: string | null;
  admissionClassId: string | null;
}

export interface BulkEnrollResult {
  enrolled: Enrollment[];
  skipped: Array<{ studentId: string; reason: string }>;
}

export interface EnrollmentTransfer {
  id: string;
  enrollmentId: string;
  fromSectionId: string;
  toSectionId: string;
  fromRollNo: number | null;
  toRollNo: number | null;
  reason: string | null;
  transferredBy: string | null;
  createdAt: string;
}

export interface EnrollmentListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  sessionId?: string;
  sectionId?: string;
  classId?: string;
  studentId?: string;
  status?: EnrollmentStatus;
}

export interface EnrollInput {
  studentId: string;
  sessionId: string;
  sectionId: string;
  groupId?: string;
  shiftId?: string;
  rollNo?: number;
  enrollmentDate?: string;
  type?: EnrollmentType;
  optionalSubjectId?: string;
  overrideCapacity?: boolean;
}

// ── promotions ──────────────────────────────────────────────────────

export interface PromotionMapping {
  fromClassId: string;
  toClassId?: string;
  toSectionId?: string;
}

export interface PromotionBatch {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  status: PromotionBatchStatus;
  criteria: { mappings?: PromotionMapping[]; builtAt?: string };
  executedBy: string | null;
  executedAt: string | null;
  createdAt: string;
  fromSession: { id: string; name: string };
  toSession: { id: string; name: string };
  _count: { items: number };
}

export interface PromotionItem {
  id: string;
  studentId: string;
  fromEnrollmentId: string | null;
  decision: PromotionDecision;
  toClassId: string | null;
  toSectionId: string | null;
  toEnrollmentId: string | null;
  student: {
    id: string;
    studentUid: string;
    firstName: string;
    lastName: string;
    nameBn: string | null;
  };
  toClass: { id: string; name: string; numericLevel: number } | null;
  toSection: { id: string; name: string } | null;
  fromEnrollment: {
    id: string;
    rollNo: number;
    classId: string;
    sectionId: string;
    class: { id: string; name: string; numericLevel: number };
    section: { id: string; name: string };
  } | null;
}

export interface PromotionBatchDetail {
  batch: PromotionBatch;
  items: PromotionItem[];
}

export interface PromotionPreview {
  batch: PromotionBatch;
  counts: Record<PromotionDecision, number>;
  targetSections: Array<{ sectionId: string; count: number }>;
  warnings: string[];
}

export interface PromotionExecutionResult {
  promoted: number;
  retained: number;
  graduated: number;
  excluded: number;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

export const enrollmentApi = {
  async list(
    query: EnrollmentListQuery = {},
  ): Promise<{ data: Enrollment[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<Enrollment[]>>("/enrollments", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async enrollable(
    sessionId: string,
    search?: string,
  ): Promise<EnrollableStudent[]> {
    const res = await api.get<ApiEnvelope<EnrollableStudent[]>>(
      "/enrollments/enrollable",
      { params: params({ sessionId, search }) },
    );
    return res.data.data;
  },

  async sectionRoster(sectionId: string): Promise<Enrollment[]> {
    const res = await api.get<ApiEnvelope<Enrollment[]>>(
      `/sections/${sectionId}/students`,
    );
    return res.data.data;
  },

  async enroll(input: EnrollInput): Promise<Enrollment> {
    const res = await api.post<ApiEnvelope<Enrollment>>("/enrollments", input);
    return res.data.data;
  },

  async bulkEnroll(input: {
    sessionId: string;
    sectionId: string;
    studentIds: string[];
    rollStrategy?: RollStrategy;
    overrideCapacity?: boolean;
  }): Promise<BulkEnrollResult> {
    const res = await api.post<ApiEnvelope<BulkEnrollResult>>(
      "/enrollments/bulk",
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: {
      rollNo?: number;
      optionalSubjectId?: string | null;
      groupId?: string | null;
      shiftId?: string | null;
    },
  ): Promise<Enrollment> {
    const res = await api.put<ApiEnvelope<Enrollment>>(
      `/enrollments/${id}`,
      input,
    );
    return res.data.data;
  },

  async transferSection(
    id: string,
    input: {
      toSectionId: string;
      keepRoll?: boolean;
      reason?: string;
      overrideCapacity?: boolean;
    },
  ): Promise<Enrollment> {
    const res = await api.post<ApiEnvelope<Enrollment>>(
      `/enrollments/${id}/transfer-section`,
      input,
    );
    return res.data.data;
  },

  async transfers(id: string): Promise<EnrollmentTransfer[]> {
    const res = await api.get<ApiEnvelope<EnrollmentTransfer[]>>(
      `/enrollments/${id}/transfers`,
    );
    return res.data.data;
  },

  async rollAssign(input: {
    sectionId: string;
    sessionId: string;
    strategy: RenumberStrategy;
    startFrom?: number;
  }): Promise<Enrollment[]> {
    const res = await api.post<ApiEnvelope<Enrollment[]>>(
      "/enrollments/roll-assign",
      input,
    );
    return res.data.data;
  },

  async cancel(id: string, reason?: string): Promise<void> {
    await api.delete(`/enrollments/${id}`, { data: { reason } });
  },
};

export const promotionApi = {
  async list(
    query: { page?: number; limit?: number; fromSessionId?: string } = {},
  ): Promise<{ data: PromotionBatch[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<PromotionBatch[]>>("/promotions", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<PromotionBatchDetail> {
    const res = await api.get<ApiEnvelope<PromotionBatchDetail>>(
      `/promotions/${id}`,
    );
    return res.data.data;
  },

  async create(input: {
    fromSessionId: string;
    toSessionId: string;
    mappings?: PromotionMapping[];
  }): Promise<PromotionBatchDetail> {
    const res = await api.post<ApiEnvelope<PromotionBatchDetail>>(
      "/promotions",
      input,
    );
    return res.data.data;
  },

  async preview(id: string): Promise<PromotionPreview> {
    const res = await api.get<ApiEnvelope<PromotionPreview>>(
      `/promotions/${id}/preview`,
    );
    return res.data.data;
  },

  async updateItems(
    id: string,
    items: Array<{
      itemId: string;
      decision: PromotionDecision;
      toClassId?: string | null;
      toSectionId?: string | null;
    }>,
  ): Promise<PromotionBatchDetail> {
    const res = await api.put<ApiEnvelope<PromotionBatchDetail>>(
      `/promotions/${id}/items`,
      { items },
    );
    return res.data.data;
  },

  async execute(id: string): Promise<PromotionExecutionResult> {
    const res = await api.post<ApiEnvelope<PromotionExecutionResult>>(
      `/promotions/${id}/execute`,
      {},
    );
    return res.data.data;
  },

  async rollback(id: string): Promise<void> {
    await api.post(`/promotions/${id}/rollback`);
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/promotions/${id}`);
  },
};
