import { api, ApiEnvelope } from "./axios";

/** Mirrors the backend marks & result-processing API shapes (Module 15). */

export type MarkStatus = "DRAFT" | "SUBMITTED" | "VERIFIED" | "LOCKED";
export type ResultStatus = "PASSED" | "FAILED" | "INCOMPLETE" | "WITHHELD";
export type ResultRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type MarkComponent = "cq" | "mcq" | "practical" | "ca";

export interface ExamPaper {
  examSubjectId: string;
  examId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectNameBn: string | null;
  subjectCode: string | null;
  fullMarks: number;
  passMarks: number;
  componentMarks: Partial<Record<MarkComponent, number | null>>;
  componentPassMarks: Partial<Record<MarkComponent, number | null>>;
  isOptional: boolean;
  displayOrder: number;
}

export interface MarkGridRow {
  enrollmentId: string;
  studentId: string;
  studentUid: string;
  studentName: string;
  rollNo: number;
  sectionId: string;
  sectionName: string;
  markId: string | null;
  cq: number | null;
  mcq: number | null;
  practical: number | null;
  ca: number | null;
  total: number;
  isAbsent: boolean;
  grade: string | null;
  gradePoint: number | null;
  status: MarkStatus;
  remarks: string | null;
}

export interface MarkGrid {
  paper: ExamPaper;
  /** Columns the grid renders — empty means a single "Marks" column. */
  components: MarkComponent[];
  status: MarkStatus;
  editable: boolean;
  entered: number;
  rows: MarkGridRow[];
}

export interface PaperMarkStatus {
  examSubjectId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  candidates: number;
  entered: number;
  status: MarkStatus;
  locked: boolean;
}

export interface MarkInput {
  enrollmentId: string;
  cq?: number | null;
  mcq?: number | null;
  practical?: number | null;
  ca?: number | null;
  total?: number | null;
  isAbsent?: boolean;
  remarks?: string | null;
}

export interface MarkCellError {
  enrollmentId: string;
  field: string;
  message: string;
}

export interface MarkCorrection {
  id: string;
  markId: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  reason: string;
  correctedBy: string;
  createdAt: string;
}

export interface ResultRun {
  id: string;
  examId: string;
  status: ResultRunStatus;
  total: number;
  processed: number;
  issues: Array<{
    enrollmentId: string;
    studentName: string;
    rollNo: number;
    kind: string;
    detail: string;
  }> | null;
  error: string | null;
  override: boolean;
  scopeEnrollmentId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ProcessingStatus {
  run: ResultRun | null;
  results: number;
  byStatus: Array<{ status: ResultStatus; count: number }>;
  unlockedPapers: number;
  /** Marks changed since the last run — the results no longer match. */
  stale: boolean;
}

export interface ResultRow {
  id: string;
  examId: string;
  enrollmentId: string;
  totalMarks: string;
  obtainedMarks: string;
  gpa: string;
  gpaWithoutOptional: string;
  grade: string;
  subjectsCount: number;
  failedSubjects: number;
  status: ResultStatus;
  meritPositionSection: number | null;
  meritPositionClass: number | null;
  withheldReason: string | null;
  publishedAt: string | null;
  enrollment: {
    id: string;
    rollNo: number;
    classId: string;
    sectionId: string;
    student: { id: string; studentUid: string; firstName: string; lastName: string };
    class: { id: string; name: string };
    section: { id: string; name: string };
  };
  exam: { id: string; name: string };
}

export interface ResultSubjectRow {
  examSubjectId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  isOptional: boolean;
  fullMarks: number;
  passMarks: number;
  cq: number | null;
  mcq: number | null;
  practical: number | null;
  ca: number | null;
  obtained: number;
  graceApplied: number;
  isAbsent: boolean;
  grade: string;
  gradePoint: number;
  passed: boolean;
  failedComponents: string[];
}

export interface ResultDetail {
  result: ResultRow;
  subjects: ResultSubjectRow[];
  published: boolean;
}

export interface TabulationSheet {
  exam: { id: string; name: string; sessionName: string };
  scope: string;
  papers: Array<{
    examSubjectId: string;
    subjectName: string;
    fullMarks: number;
  }>;
  rows: Array<{
    enrollmentId: string;
    rollNo: number;
    studentUid: string;
    studentName: string;
    sectionName: string;
    marks: Record<
      string,
      { obtained: number; grade: string; absent: boolean } | null
    >;
    totalMarks: number;
    obtainedMarks: number;
    gpa: number;
    grade: string;
    status: ResultStatus;
    meritPositionSection: number | null;
    meritPositionClass: number | null;
  }>;
  summary: {
    candidates: number;
    passed: number;
    failed: number;
    incomplete: number;
  };
}

export interface PassRateRow {
  id: string;
  label: string;
  candidates: number;
  passed: number;
  failed: number;
  incomplete: number;
  passRate: number;
  averageGpa: number;
}

export interface ResultAnalytics {
  exam: { id: string; name: string };
  overall: PassRateRow;
  byClass: PassRateRow[];
  bySection: PassRateRow[];
  gpaDistribution: Array<{ grade: string; count: number }>;
  subjects: Array<{
    examSubjectId: string;
    label: string;
    subjectName: string;
    className: string;
    marksEntered: number;
    absent: number;
    averagePercentage: number;
    passRate: number;
    highest: number;
    lowest: number;
  }>;
  comparison: Array<{
    examId: string;
    examName: string;
    passRate: number;
    averageGpa: number;
    candidates: number;
  }>;
}

export interface ResultPublication {
  id: string;
  examId: string;
  version: number;
  channels: { portal?: boolean; website?: boolean; sms?: boolean };
  isActive: boolean;
  note: string | null;
  publishedAt: string;
  revokedAt: string | null;
}

export interface PublicationHistory {
  publications: ResultPublication[];
  active: ResultPublication | null;
  published: boolean;
}

export interface CombinedResultRow {
  id: string;
  name: string;
  gpa: string;
  grade: string;
  status: ResultStatus;
  obtainedMarks: string;
  totalMarks: string;
  weights: Record<string, number>;
  components: Array<{ examId: string; examName: string; weight: number }>;
  meritPositionSection: number | null;
  meritPositionClass: number | null;
  enrollment: {
    rollNo: number;
    student: { studentUid: string; firstName: string; lastName: string };
    class: { name: string };
    section: { name: string };
  };
}

/**
 * Per-cell errors from a refused save. The grid paints these — the
 * top-level message is only the count, so this is what the UI needs.
 */
export function markErrorsFromError(err: unknown): MarkCellError[] {
  const details = (
    err as {
      response?: {
        data?: { error?: { details?: { marks?: MarkCellError[] } } };
      };
    }
  )?.response?.data?.error?.details?.marks;
  return Array.isArray(details) ? details : [];
}

/** Papers a refused processing run named as unlocked. */
export function unlockedPapersFromError(
  err: unknown,
): Array<{ label: string; status: string }> {
  const details = (
    err as {
      response?: {
        data?: {
          error?: {
            details?: { unlockedPapers?: Array<{ label: string; status: string }> };
          };
        };
      };
    }
  )?.response?.data?.error?.details?.unlockedPapers;
  return Array.isArray(details) ? details : [];
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams a file endpoint straight to a browser download. */
async function download(
  path: string,
  query: object = {},
  fallback = "result.pdf",
): Promise<void> {
  const res = await api.get<Blob>(path, {
    params: params(query),
    responseType: "blob",
  });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

export const markApi = {
  async grid(
    examId: string,
    query: { examSubjectId: string; sectionId?: string },
  ): Promise<MarkGrid> {
    const res = await api.get<ApiEnvelope<MarkGrid>>(
      `/exams/${examId}/marks`,
      { params: params(query) },
    );
    return res.data.data;
  },

  async statuses(examId: string): Promise<PaperMarkStatus[]> {
    const res = await api.get<ApiEnvelope<PaperMarkStatus[]>>(
      `/exams/${examId}/marks/status`,
    );
    return res.data.data;
  },

  async corrections(examId: string): Promise<MarkCorrection[]> {
    const res = await api.get<ApiEnvelope<MarkCorrection[]>>(
      `/exams/${examId}/marks/corrections`,
    );
    return res.data.data;
  },

  async save(
    examId: string,
    input: { examSubjectId: string; marks: MarkInput[] },
  ): Promise<{ saved: number; status: MarkStatus }> {
    const res = await api.put<ApiEnvelope<{ saved: number; status: MarkStatus }>>(
      `/exams/${examId}/marks`,
      input,
    );
    return res.data.data;
  },

  async advance(
    examId: string,
    action: "submit" | "verify" | "lock",
    examSubjectId: string,
  ): Promise<{ moved: number; status: MarkStatus }> {
    const res = await api.post<
      ApiEnvelope<{ moved: number; status: MarkStatus }>
    >(`/exams/${examId}/marks/${action}`, { examSubjectId });
    return res.data.data;
  },

  async correct(
    examId: string,
    markId: string,
    input: MarkInput & { reason: string; reprocess?: boolean },
  ): Promise<{ markId: string; run: ResultRun | null }> {
    const res = await api.put<
      ApiEnvelope<{ markId: string; run: ResultRun | null }>
    >(`/exams/${examId}/marks/${markId}/correct`, input);
    return res.data.data;
  },
};

export const resultApi = {
  // ── processing ──────────────────────────────────────────────────────

  async process(
    examId: string,
    input: { override?: boolean; enrollmentId?: string } = {},
  ): Promise<{ run: ResultRun; mode: "queued" | "inline" }> {
    const res = await api.post<
      ApiEnvelope<{ run: ResultRun; mode: "queued" | "inline" }>
    >(`/exams/${examId}/process`, input);
    return res.data.data;
  },

  async processStatus(examId: string): Promise<ProcessingStatus> {
    const res = await api.get<ApiEnvelope<ProcessingStatus>>(
      `/exams/${examId}/process/status`,
    );
    return res.data.data;
  },

  async processHistory(examId: string): Promise<ResultRun[]> {
    const res = await api.get<ApiEnvelope<ResultRun[]>>(
      `/exams/${examId}/process/history`,
    );
    return res.data.data;
  },

  // ── results ─────────────────────────────────────────────────────────

  async list(
    examId: string,
    query: {
      classId?: string;
      sectionId?: string;
      status?: ResultStatus;
      search?: string;
    } = {},
  ): Promise<{ results: ResultRow[]; published: boolean }> {
    const res = await api.get<
      ApiEnvelope<{ results: ResultRow[]; published: boolean }>
    >(`/exams/${examId}/results`, { params: params(query) });
    return res.data.data;
  },

  async forCandidate(
    examId: string,
    enrollmentId: string,
  ): Promise<ResultDetail> {
    const res = await api.get<ApiEnvelope<ResultDetail>>(
      `/exams/${examId}/results/${enrollmentId}`,
    );
    return res.data.data;
  },

  async withhold(
    id: string,
    input: { withheld: boolean; reason?: string },
  ): Promise<ResultRow> {
    const res = await api.put<ApiEnvelope<ResultRow>>(
      `/results/${id}/withhold`,
      input,
    );
    return res.data.data;
  },

  // ── publication ─────────────────────────────────────────────────────

  async publications(examId: string): Promise<PublicationHistory> {
    const res = await api.get<ApiEnvelope<PublicationHistory>>(
      `/exams/${examId}/publications`,
    );
    return res.data.data;
  },

  async publish(
    examId: string,
    input: {
      channels?: { portal?: boolean; website?: boolean; sms?: boolean };
      note?: string;
    },
  ): Promise<{
    publication: ResultPublication;
    results: number;
    smsQueued: number;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        publication: ResultPublication;
        results: number;
        smsQueued: number;
      }>
    >(`/exams/${examId}/publish`, input);
    return res.data.data;
  },

  async unpublish(examId: string, reason: string): Promise<{ revoked: number }> {
    const res = await api.post<ApiEnvelope<{ revoked: number }>>(
      `/exams/${examId}/unpublish`,
      { reason },
    );
    return res.data.data;
  },

  // ── reports ─────────────────────────────────────────────────────────

  async tabulation(
    examId: string,
    query: { classId?: string; sectionId?: string } = {},
  ): Promise<TabulationSheet> {
    const res = await api.get<ApiEnvelope<TabulationSheet>>(
      `/exams/${examId}/tabulation`,
      { params: params(query) },
    );
    return res.data.data;
  },

  async analytics(examId: string): Promise<ResultAnalytics> {
    const res = await api.get<ApiEnvelope<ResultAnalytics>>(
      `/exams/${examId}/analytics`,
    );
    return res.data.data;
  },

  downloadTabulation(
    examId: string,
    format: "xlsx" | "pdf",
    query: { classId?: string; sectionId?: string } = {},
  ): Promise<void> {
    return download(
      `/exams/${examId}/tabulation.${format}`,
      query,
      `tabulation.${format}`,
    );
  },

  downloadReportCards(
    examId: string,
    query: { classId?: string; sectionId?: string; enrollmentId?: string } = {},
  ): Promise<void> {
    return download(
      `/exams/${examId}/report-cards`,
      query,
      "report-cards.pdf",
    );
  },

  downloadTranscript(studentId: string, sessionId?: string): Promise<void> {
    return download(
      `/students/${studentId}/transcript.pdf`,
      { sessionId },
      "transcript.pdf",
    );
  },
};

export const combinedResultApi = {
  async batches(
    sessionId?: string,
  ): Promise<Array<{ name: string; generatedAt: string; candidates: number }>> {
    const res = await api.get<
      ApiEnvelope<
        Array<{ name: string; generatedAt: string; candidates: number }>
      >
    >("/combined-results/batches", { params: params({ sessionId }) });
    return res.data.data;
  },

  async list(query: {
    name: string;
    sessionId?: string;
    classId?: string;
    sectionId?: string;
  }): Promise<CombinedResultRow[]> {
    const res = await api.get<ApiEnvelope<CombinedResultRow[]>>(
      "/combined-results",
      { params: params(query) },
    );
    return res.data.data;
  },

  async generate(input: {
    name: string;
    sessionId?: string;
    components: Array<{ examId: string; weight: number }>;
  }): Promise<{
    name: string;
    generated: number;
    skipped: Array<{ enrollmentId: string; reason: string }>;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        name: string;
        generated: number;
        skipped: Array<{ enrollmentId: string; reason: string }>;
      }>
    >("/combined-results/generate", input);
    return res.data.data;
  },

  async remove(name: string, sessionId?: string): Promise<{ removed: number }> {
    const res = await api.delete<ApiEnvelope<{ removed: number }>>(
      "/combined-results",
      { params: params({ name, sessionId }) },
    );
    return res.data.data;
  },
};
