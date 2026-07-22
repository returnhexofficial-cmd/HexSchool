import { api, ApiEnvelope, PaginationMeta } from "./axios";

export interface Paged<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Mirrors the backend examination API shapes (Module 14). */

export type ExamStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ONGOING"
  | "MARK_ENTRY"
  | "PROCESSING"
  | "PUBLISHED"
  | "ARCHIVED";

export type SeatPlanStrategy = "SERPENTINE" | "INTERLEAVE";

export type ExamClashKind =
  | "ROOM"
  | "CLASS_OVERLAP"
  | "CLASS_SAME_DAY"
  | "OUTSIDE_WINDOW"
  | "DUPLICATE_PAPER";

export interface ExamClash {
  kind: ExamClashKind;
  examSubjectId: string | null;
  date: string;
  classId: string;
  subjectId: string;
  message: string;
  clashesWith?: {
    examSubjectId: string | null;
    classLabel: string;
    subjectName: string;
    room: string | null;
    window: string;
  };
}

export interface ExamType {
  id: string;
  name: string;
  weight: string | null;
}

export interface ExamSummary {
  id: string;
  sessionId: string;
  examTypeId: string;
  name: string;
  startDate: string;
  endDate: string;
  gradingSystemId: string;
  status: ExamStatus;
  resultPublishAt: string | null;
  instructions: string | null;
  examType: { id: string; name: string; weight: string | null };
  session: { id: string; name: string; status: string };
  gradingSystem: { id: string; name: string; isDefault: boolean };
  examClasses: Array<{
    classId: string;
    class: { id: string; name: string; numericLevel: number };
  }>;
}

export interface ExamOverview {
  exam: ExamSummary;
  papers: { total: number; scheduled: number; unscheduled: number };
  seatPlans: number;
  nextStatuses: ExamStatus[];
  shapeEditable: boolean;
}

export interface ExamSubject {
  id: string;
  examId: string;
  classId: string;
  subjectId: string;
  fullMarks: number;
  passMarks: number;
  cqMarks: number | null;
  mcqMarks: number | null;
  practicalMarks: number | null;
  caMarks: number | null;
  cqPassMarks: number | null;
  mcqPassMarks: number | null;
  practicalPassMarks: number | null;
  caPassMarks: number | null;
  examDate: string | null;
  startTime: string | null;
  durationMin: number | null;
  room: string | null;
  subject: {
    id: string;
    name: string;
    nameBn: string | null;
    code: string;
    type: string;
  };
  class: { id: string; name: string; numericLevel: number };
}

export interface ExamSubjectInput {
  classId: string;
  subjectId: string;
  fullMarks: number;
  passMarks: number;
  cqMarks?: number | null;
  mcqMarks?: number | null;
  practicalMarks?: number | null;
  caMarks?: number | null;
  cqPassMarks?: number | null;
  mcqPassMarks?: number | null;
  practicalPassMarks?: number | null;
  caPassMarks?: number | null;
  examDate?: string | null;
  startTime?: string | null;
  durationMin?: number | null;
  room?: string | null;
}

export interface RoutineSitting {
  examSubjectId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  room: string | null;
  fullMarks: number;
  passMarks: number;
}

export interface RoutineDay {
  date: string;
  holiday: boolean;
  holidayTitle?: string;
  sittings: RoutineSitting[];
}

export interface ExamRoutine {
  exam: {
    id: string;
    name: string;
    status: ExamStatus;
    startDate: string;
    endDate: string;
    examTypeName: string;
    sessionName: string;
  };
  days: RoutineDay[];
  unscheduled: Array<{
    examSubjectId: string;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
  }>;
  clashes: ExamClash[];
}

export interface SubjectSyncDiff {
  missing: Array<{
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
  }>;
  stale: Array<{
    examSubjectId: string;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    scheduled: boolean;
  }>;
}

export interface SeatPlan {
  id: string;
  room: string;
  date: string;
  capacity: number;
  strategy: SeatPlanStrategy;
  entries: Array<{
    id: string;
    seatNo: number;
    enrollmentId: string;
    enrollment: {
      id: string;
      rollNo: number;
      student: {
        id: string;
        studentUid: string;
        firstName: string;
        lastName: string;
      };
      class: { id: string; name: string };
      section: { id: string; name: string };
    };
  }>;
}

export interface SeatPlanCandidate {
  enrollmentId: string;
  classId: string;
  rollNo: number;
  studentId: string;
  studentUid: string;
  studentName: string;
  className: string;
  sectionName: string;
}

export interface SeatPlanGenerationResult {
  date: string;
  strategy: SeatPlanStrategy;
  rooms: number;
  seated: number;
  candidates: number;
  capacity: number;
  plans: SeatPlan[];
}

export interface AdmitCardCounts {
  issued: number;
  incomplete: number;
  blocked: number;
}

/**
 * The clash list a rejected save/schedule carries. The backend refuses
 * the whole payload with a 409 and puts the offending sittings in the
 * envelope's `error.details.clashes`, which is what lets the routine grid
 * paint them red instead of only showing a toast. `waivable` holds the
 * same-day warnings an override would let through.
 */
export function clashesFromError(err: unknown): {
  clashes: ExamClash[];
  waivable: ExamClash[];
} {
  const details = (
    err as {
      response?: {
        data?: {
          error?: {
            details?: { clashes?: ExamClash[]; waivable?: ExamClash[] };
          };
        };
      };
    }
  )?.response?.data?.error?.details;
  return {
    clashes: Array.isArray(details?.clashes) ? details.clashes : [],
    waivable: Array.isArray(details?.waivable) ? details.waivable : [],
  };
}

/** Row-level validation errors from a rejected paper grid (400). */
export function paperErrorsFromError(err: unknown): string[] {
  const details = (
    err as {
      response?: {
        data?: { error?: { details?: { errors?: string[] } } };
      };
    }
  )?.response?.data?.error?.details?.errors;
  return Array.isArray(details) ? details : [];
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams a PDF endpoint straight to a browser download. */
async function download(
  path: string,
  query: object = {},
  fallback = "exam.pdf",
): Promise<void> {
  const res = await api.get<Blob>(path, {
    params: params(query),
    responseType: "blob",
  });
  saveBlob(res.data, String(res.headers["content-disposition"] ?? ""), fallback);
}

function saveBlob(blob: Blob, disposition: string, fallback: string): void {
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

export const examTypeApi = {
  async list(): Promise<ExamType[]> {
    const res = await api.get<ApiEnvelope<ExamType[]>>("/exam-types");
    return res.data.data;
  },

  async create(input: { name: string; weight?: number }): Promise<ExamType> {
    const res = await api.post<ApiEnvelope<ExamType>>("/exam-types", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: { name?: string; weight?: number | null },
  ): Promise<ExamType> {
    const res = await api.put<ApiEnvelope<ExamType>>(
      `/exam-types/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/exam-types/${id}`);
  },
};

export const examApi = {
  async list(query: {
    sessionId?: string;
    examTypeId?: string;
    classId?: string;
    status?: ExamStatus;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<Paged<ExamSummary>> {
    const res = await api.get<ApiEnvelope<ExamSummary[]>>("/exams", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<ExamOverview> {
    const res = await api.get<ApiEnvelope<ExamOverview>>(`/exams/${id}`);
    return res.data.data;
  },

  async create(input: {
    examTypeId: string;
    name: string;
    sessionId?: string;
    startDate: string;
    endDate: string;
    gradingSystemId?: string;
    classIds?: string[];
    instructions?: string;
  }): Promise<ExamSummary> {
    const res = await api.post<ApiEnvelope<ExamSummary>>("/exams", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<{
      examTypeId: string;
      name: string;
      startDate: string;
      endDate: string;
      gradingSystemId: string;
      instructions: string;
    }>,
  ): Promise<ExamSummary> {
    const res = await api.put<ApiEnvelope<ExamSummary>>(`/exams/${id}`, input);
    return res.data.data;
  },

  async setClasses(
    id: string,
    input: { classIds: string[]; seedSubjects?: boolean },
  ): Promise<ExamSummary> {
    const res = await api.put<ApiEnvelope<ExamSummary>>(
      `/exams/${id}/classes`,
      input,
    );
    return res.data.data;
  },

  async changeStatus(
    id: string,
    input: { status: ExamStatus; override?: boolean; reason?: string },
  ): Promise<ExamSummary> {
    const res = await api.put<ApiEnvelope<ExamSummary>>(
      `/exams/${id}/status`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/exams/${id}`);
  },

  // ── papers ────────────────────────────────────────────────────────

  async subjects(id: string): Promise<ExamSubject[]> {
    const res = await api.get<ApiEnvelope<ExamSubject[]>>(
      `/exams/${id}/subjects`,
    );
    return res.data.data;
  },

  async replaceSubjects(
    id: string,
    input: { subjects: ExamSubjectInput[]; override?: boolean },
  ): Promise<{ saved: number; removed: number; warnings: ExamClash[] }> {
    const res = await api.put<
      ApiEnvelope<{ saved: number; removed: number; warnings: ExamClash[] }>
    >(`/exams/${id}/subjects`, input);
    return res.data.data;
  },

  async updateSubject(
    id: string,
    subjectId: string,
    input: Partial<ExamSubjectInput> & { override?: boolean },
  ): Promise<ExamSubject> {
    const res = await api.put<ApiEnvelope<ExamSubject>>(
      `/exams/${id}/subjects/${subjectId}`,
      input,
    );
    return res.data.data;
  },

  async removeSubject(id: string, subjectId: string): Promise<void> {
    await api.delete(`/exams/${id}/subjects/${subjectId}`);
  },

  async syncPreview(id: string): Promise<SubjectSyncDiff> {
    const res = await api.get<ApiEnvelope<SubjectSyncDiff>>(
      `/exams/${id}/subjects-sync`,
    );
    return res.data.data;
  },

  async syncApply(
    id: string,
    input: { addMissing?: boolean; removeStale?: boolean },
  ): Promise<{ added: number; removed: number; diff: SubjectSyncDiff }> {
    const res = await api.post<
      ApiEnvelope<{ added: number; removed: number; diff: SubjectSyncDiff }>
    >(`/exams/${id}/subjects-sync`, input);
    return res.data.data;
  },

  // ── routine ───────────────────────────────────────────────────────

  async routine(id: string): Promise<ExamRoutine> {
    const res = await api.get<ApiEnvelope<ExamRoutine>>(`/exams/${id}/routine`);
    return res.data.data;
  },

  async shiftDay(
    id: string,
    input: {
      fromDate: string;
      toDate: string;
      extendExamWindow?: boolean;
      override?: boolean;
      reason?: string;
    },
  ): Promise<{ moved: number; routine: ExamRoutine }> {
    const res = await api.post<
      ApiEnvelope<{ moved: number; routine: ExamRoutine }>
    >(`/exams/${id}/routine/shift-day`, input);
    return res.data.data;
  },

  downloadRoutine(id: string): Promise<void> {
    return download(`/exams/${id}/routine/pdf`, {}, "exam-routine.pdf");
  },

  // ── seat plans ────────────────────────────────────────────────────

  async seatPlans(id: string, date?: string): Promise<SeatPlan[]> {
    const res = await api.get<ApiEnvelope<SeatPlan[]>>(
      `/exams/${id}/seat-plans`,
      { params: params({ date }) },
    );
    return res.data.data;
  },

  async seatPlanCandidates(
    id: string,
    date: string,
  ): Promise<SeatPlanCandidate[]> {
    const res = await api.get<ApiEnvelope<SeatPlanCandidate[]>>(
      `/exams/${id}/seat-plans/candidates`,
      { params: params({ date }) },
    );
    return res.data.data;
  },

  async generateSeatPlan(
    id: string,
    input: {
      date: string;
      rooms: Array<{ room: string; capacity: number }>;
      strategy?: SeatPlanStrategy;
    },
  ): Promise<SeatPlanGenerationResult> {
    const res = await api.post<ApiEnvelope<SeatPlanGenerationResult>>(
      `/exams/${id}/seat-plans/generate`,
      input,
    );
    return res.data.data;
  },

  async appendCandidate(
    id: string,
    input: { date: string; enrollmentId: string },
  ): Promise<{ room: string; seatNo: number }> {
    const res = await api.post<ApiEnvelope<{ room: string; seatNo: number }>>(
      `/exams/${id}/seat-plans/append`,
      input,
    );
    return res.data.data;
  },

  async removeSeatPlan(id: string, date: string): Promise<void> {
    await api.delete(`/exams/${id}/seat-plans`, { params: { date } });
  },

  downloadSeatPlan(id: string, date?: string): Promise<void> {
    return download(`/exams/${id}/seat-plans/pdf`, { date }, "seat-plan.pdf");
  },

  // ── admit cards ───────────────────────────────────────────────────

  /**
   * Returns the PDF as a download plus the counts the backend reports in
   * `X-Admit-Cards-*` headers — issued, photo-less, and dues-blocked.
   */
  async admitCards(
    id: string,
    input: {
      sectionId?: string;
      classId?: string;
      enrollmentIds?: string[];
      ignoreDues?: boolean;
    },
  ): Promise<AdmitCardCounts> {
    const res = await api.post<Blob>(`/exams/${id}/admit-cards`, input, {
      responseType: "blob",
    });
    saveBlob(
      res.data,
      String(res.headers["content-disposition"] ?? ""),
      "admit-cards.pdf",
    );
    const num = (key: string) => Number(res.headers[key] ?? 0);
    return {
      issued: num("x-admit-cards-issued"),
      incomplete: num("x-admit-cards-incomplete"),
      blocked: num("x-admit-cards-blocked"),
    };
  },
};
