import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Assignments & Homework API (Module 22): teacher-scoped
 * assignment CRUD and the publish/close lifecycle, the submission grid with
 * inline evaluation and the bulk save, the learning-material library, and
 * the student/parent portal reads.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type AssignmentType = "ASSIGNMENT" | "HOMEWORK";
export type AssignmentStatus = "DRAFT" | "PUBLISHED" | "CLOSED";
export type SubmissionStatus =
  | "SUBMITTED"
  | "RESUBMITTED"
  | "EVALUATED"
  | "RETURNED";
export type MaterialType = "NOTE" | "SLIDE" | "VIDEO_URL" | "LINK" | "OTHER";

export const ASSIGNMENT_TYPES: AssignmentType[] = ["ASSIGNMENT", "HOMEWORK"];

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  ASSIGNMENT: "Assignment",
  HOMEWORK: "Homework",
};

/** The lifecycle, in order — the status strip reads this, not a literal. */
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  CLOSED: "Closed",
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  SUBMITTED: "Submitted",
  RESUBMITTED: "Resubmitted",
  EVALUATED: "Evaluated",
  RETURNED: "Returned for revision",
};

export const MATERIAL_TYPES: MaterialType[] = [
  "NOTE",
  "SLIDE",
  "VIDEO_URL",
  "LINK",
  "OTHER",
];

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  NOTE: "Note",
  SLIDE: "Slides",
  VIDEO_URL: "Video link",
  LINK: "Web link",
  OTHER: "Other",
};

/** A material of these types carries a URL rather than uploaded files. */
export const LINK_MATERIAL_TYPES: MaterialType[] = ["VIDEO_URL", "LINK"];

// ── shapes ──────────────────────────────────────────────────────────────

export interface Attachment {
  /** S3 object key — the stable reference (URLs are signed per read). */
  key: string;
  name: string;
  size: number;
  contentType: string;
}

export interface UploadedAttachment extends Attachment {
  url: string;
}

export interface AssignmentRef {
  id: string;
  name: string;
  code?: string | null;
}

export interface Assignment {
  id: string;
  sessionId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  type: AssignmentType;
  title: string;
  instructions: string | null;
  attachmentUrls: Attachment[];
  assignedAt: string;
  dueAt: string;
  fullMarks: string | null;
  allowLate: boolean;
  status: AssignmentStatus;
  publishedAt: string | null;
  closedAt: string | null;
  section: {
    id: string;
    name: string;
    class: { id: string; name: string; numericLevel: number };
  };
  subject: { id: string; name: string; nameBn: string | null; code: string };
  teacher: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
  };
}

export interface AssignmentStats {
  expected: number;
  submitted: number;
  pending: number;
  late: number;
  evaluated: number;
  returned: number;
  submissionRate: number;
  averageMarks: number | null;
  highestMarks: number | null;
  lowestMarks: number | null;
}

export interface Submission {
  id: string;
  assignmentId: string;
  enrollmentId: string;
  textAnswer: string | null;
  attachmentUrls: Attachment[];
  submittedAt: string;
  isLate: boolean;
  attempt: number;
  marks: string | null;
  feedback: string | null;
  evaluatedAt: string | null;
  status: SubmissionStatus;
}

export interface SubmissionGridRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  rollNo: number;
  submission: Submission | null;
  /** Submitted, then moved section — kept on the grid, flagged (§8). */
  transferredOut: boolean;
}

export interface SubmissionGrid {
  rows: SubmissionGridRow[];
  stats: AssignmentStats;
}

export interface LearningMaterial {
  id: string;
  sessionId: string;
  classId: string;
  sectionId: string | null;
  subjectId: string;
  teacherId: string;
  type: MaterialType;
  title: string;
  description: string | null;
  fileUrls: Attachment[];
  linkUrl: string | null;
  createdAt: string;
  class: { id: string; name: string; numericLevel: number };
  section: { id: string; name: string } | null;
  subject: { id: string; name: string; nameBn: string | null; code: string };
  teacher: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
  };
}

/** One row of the student portal's list, with the verdict already applied. */
export interface PortalAssignment {
  id: string;
  type: AssignmentType;
  title: string;
  instructions: string | null;
  attachments: Attachment[];
  subject: { id: string; name: string; code: string };
  teacher: string;
  assignedAt: string;
  dueAt: string;
  fullMarks: string | null;
  allowLate: boolean;
  status: AssignmentStatus;
  overdue: boolean;
  submission: {
    id: string;
    status: SubmissionStatus;
    submittedAt: string;
    isLate: boolean;
    attempt: number;
    textAnswer: string | null;
    attachments: Attachment[];
    marks: string | null;
    feedback: string | null;
    evaluatedAt: string | null;
  } | null;
  canSubmit: boolean;
  /** Why not, in words — the backend engine's message, not ours. */
  submitBlockedReason: string | null;
}

export interface PortalAssignmentList {
  enrollmentId: string;
  sectionId: string;
  assignments: PortalAssignment[];
  summary: {
    total: number;
    pending: number;
    overdue: number;
    dueSoon: number;
    submitted: number;
    evaluated: number;
  };
}

export interface EvaluationIssue {
  submissionId: string;
  field: "marks" | "feedback" | "status";
  message: string;
}

// ── helpers ─────────────────────────────────────────────────────────────

const params = (query: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null,
    ),
  );

/** `2026-07-30T18:00:00Z` → `Thu 30 Jul, 6:00 pm` in Asia/Dhaka. */
export function formatDue(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** `in 3 days` / `2 hours ago` — the badge on a due date. */
export function dueRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const unit: [number, Intl.RelativeTimeFormatUnit] =
    abs < 3_600_000
      ? [60_000, "minute"]
      : abs < 86_400_000
        ? [3_600_000, "hour"]
        : [86_400_000, "day"];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round(diff / unit[0]),
    unit[1],
  );
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * A `datetime-local` input value (`2026-07-30T18:00`, wall clock, no
 * zone) → an ISO instant. The browser's own timezone is what the teacher
 * typed in, so `new Date(...)` is the right conversion; formatting for
 * display goes back through `formatDue` in Asia/Dhaka.
 */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}

/** The inverse, for pre-filling the edit form. */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function downloadFile(path: string, fallback: string): Promise<void> {
  const res = await api.get<Blob>(path, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

// ── API objects ─────────────────────────────────────────────────────────

export interface AssignmentQuery {
  sessionId?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  type?: AssignmentType;
  status?: AssignmentStatus;
  mine?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AssignmentInput {
  sessionId: string;
  sectionId: string;
  subjectId: string;
  teacherId?: string;
  type?: AssignmentType;
  title: string;
  instructions?: string;
  attachments?: Attachment[];
  assignedAt?: string;
  dueAt: string;
  fullMarks?: number | null;
  allowLate?: boolean;
}

export const assignmentApi = {
  /**
   * The transform interceptor lifts `meta` to the top level and leaves the
   * rows in `data` — one unwrap, not two (the M18 lesson).
   */
  async list(
    query: AssignmentQuery = {},
  ): Promise<{ rows: Assignment[]; total: number }> {
    const res = await api.get<
      ApiEnvelope<Assignment[]> & { meta?: { total: number } }
    >("/assignments", { params: params(query) });
    return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
  },

  async detail(id: string): Promise<Assignment> {
    const res = await api.get<ApiEnvelope<Assignment>>(`/assignments/${id}`);
    return res.data.data;
  },

  async stats(id: string): Promise<AssignmentStats> {
    const res = await api.get<ApiEnvelope<AssignmentStats>>(
      `/assignments/${id}/stats`,
    );
    return res.data.data;
  },

  async submissions(id: string): Promise<SubmissionGrid> {
    const res = await api.get<ApiEnvelope<SubmissionGrid>>(
      `/assignments/${id}/submissions`,
    );
    return res.data.data;
  },

  async create(input: AssignmentInput): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>("/assignments", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<AssignmentInput>,
  ): Promise<Assignment> {
    const res = await api.patch<ApiEnvelope<Assignment>>(
      `/assignments/${id}`,
      input,
    );
    return res.data.data;
  },

  async publish(id: string): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/assignments/${id}/publish`,
      {},
    );
    return res.data.data;
  },

  async close(id: string): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/assignments/${id}/close`,
      {},
    );
    return res.data.data;
  },

  async reopen(id: string): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/assignments/${id}/reopen`,
      {},
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/assignments/${id}`);
  },

  async uploadAttachment(file: File): Promise<UploadedAttachment> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<UploadedAttachment>>(
      "/assignments/attachments",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  /** All-or-nothing: a 400 carries every bad cell in `error.details.issues`. */
  async evaluateBulk(
    id: string,
    rows: Array<{
      submissionId: string;
      marks?: number | null;
      feedback?: string;
    }>,
  ): Promise<{ updated: number }> {
    const res = await api.put<ApiEnvelope<{ updated: number }>>(
      `/assignments/${id}/evaluate`,
      { rows },
    );
    return res.data.data;
  },

  downloadSubmissions(id: string): Promise<void> {
    return downloadFile(
      `/assignments/${id}/export/submissions.zip`,
      "submissions.zip",
    );
  },

  downloadMarks(id: string): Promise<void> {
    return downloadFile(`/assignments/${id}/export/marks.xlsx`, "marks.xlsx");
  },
};

export const submissionApi = {
  async evaluate(
    id: string,
    input: { marks?: number | null; feedback?: string },
  ): Promise<Submission> {
    const res = await api.put<ApiEnvelope<Submission>>(
      `/submissions/${id}/evaluate`,
      input,
    );
    return res.data.data;
  },

  async returnForRevision(id: string, feedback: string): Promise<Submission> {
    const res = await api.put<ApiEnvelope<Submission>>(
      `/submissions/${id}/return`,
      { feedback },
    );
    return res.data.data;
  },
};

export interface MaterialQuery {
  sessionId?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  type?: MaterialType;
  mine?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface MaterialInput {
  sessionId: string;
  classId: string;
  sectionId?: string;
  subjectId: string;
  teacherId?: string;
  type?: MaterialType;
  title: string;
  description?: string;
  files?: Attachment[];
  linkUrl?: string;
}

export const materialApi = {
  async list(
    query: MaterialQuery = {},
  ): Promise<{ rows: LearningMaterial[]; total: number }> {
    const res = await api.get<
      ApiEnvelope<LearningMaterial[]> & { meta?: { total: number } }
    >("/learning-materials", { params: params(query) });
    return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
  },

  async create(input: MaterialInput): Promise<LearningMaterial> {
    const res = await api.post<ApiEnvelope<LearningMaterial>>(
      "/learning-materials",
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<MaterialInput>,
  ): Promise<LearningMaterial> {
    const res = await api.patch<ApiEnvelope<LearningMaterial>>(
      `/learning-materials/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/learning-materials/${id}`);
  },

  async uploadFile(file: File): Promise<UploadedAttachment> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<UploadedAttachment>>(
      "/learning-materials/files",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },
};

/** The student/parent side (M18 portal routes). */
export const portalAssignmentApi = {
  async list(
    query: { sessionId?: string; subjectId?: string; tab?: string } = {},
  ): Promise<PortalAssignmentList> {
    const res = await api.get<ApiEnvelope<PortalAssignmentList>>(
      "/portal/assignments",
      { params: params(query) },
    );
    return res.data.data;
  },

  async detail(id: string): Promise<PortalAssignment> {
    const res = await api.get<ApiEnvelope<PortalAssignment>>(
      `/portal/assignments/${id}`,
    );
    return res.data.data;
  },

  async submit(
    id: string,
    input: { textAnswer?: string; attachments?: Attachment[] },
  ): Promise<Submission> {
    const res = await api.post<ApiEnvelope<Submission>>(
      `/portal/assignments/${id}/submit`,
      input,
    );
    return res.data.data;
  },

  async uploadAttachment(file: File): Promise<UploadedAttachment> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<UploadedAttachment>>(
      "/portal/assignments/attachments",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async materials(subjectId?: string): Promise<LearningMaterial[]> {
    const res = await api.get<ApiEnvelope<LearningMaterial[]>>(
      "/portal/materials",
      { params: params({ subjectId }) },
    );
    return res.data.data;
  },

  async childList(
    childId: string,
    query: { sessionId?: string; subjectId?: string; tab?: string } = {},
  ): Promise<PortalAssignmentList> {
    const res = await api.get<ApiEnvelope<PortalAssignmentList>>(
      `/portal/parent/child/${childId}/assignments`,
      { params: params(query) },
    );
    return res.data.data;
  },

  async childMaterials(
    childId: string,
    subjectId?: string,
  ): Promise<LearningMaterial[]> {
    const res = await api.get<ApiEnvelope<LearningMaterial[]>>(
      `/portal/parent/child/${childId}/materials`,
      { params: params({ subjectId }) },
    );
    return res.data.data;
  },
};
