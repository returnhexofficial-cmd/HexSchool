import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Document Management & Certificates API (Module 27):
 * the layouts a certificate is printed from, the register of everything
 * issued, the clearance panel the issue wizard reads, the public
 * verification lookup, and the school's filing cabinet.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type CertificateType =
  | "TRANSFER"
  | "CHARACTER"
  | "TESTIMONIAL"
  | "PRIZE"
  | "PARTICIPATION"
  | "CUSTOM";

export type CertificateStatus = "DRAFT" | "ISSUED" | "REVOKED";
export type CertificateIssueKind = "ORIGINAL" | "DUPLICATE" | "CORRECTION";
export type ArchiveLinkType = "STUDENT" | "TEACHER" | "STAFF" | "CERTIFICATE";
export type VerificationOutcome = "VALID" | "REVOKED" | "NOT_FOUND";

export const CERTIFICATE_TYPES: CertificateType[] = [
  "TRANSFER",
  "CHARACTER",
  "TESTIMONIAL",
  "PRIZE",
  "PARTICIPATION",
  "CUSTOM",
];

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  TRANSFER: "Transfer certificate",
  CHARACTER: "Character certificate",
  TESTIMONIAL: "Testimonial",
  PRIZE: "Prize",
  PARTICIPATION: "Participation",
  CUSTOM: "Custom",
};

export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  REVOKED: "Revoked",
};

export const CERTIFICATE_STATUS_VARIANT: Record<
  CertificateStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "secondary",
  ISSUED: "default",
  REVOKED: "destructive",
};

export const ISSUE_KIND_LABELS: Record<CertificateIssueKind, string> = {
  ORIGINAL: "Original",
  DUPLICATE: "Duplicate",
  CORRECTION: "Correction",
};

export const ARCHIVE_LINK_LABELS: Record<ArchiveLinkType, string> = {
  STUDENT: "Student",
  TEACHER: "Teacher",
  STAFF: "Staff",
  CERTIFICATE: "Certificate",
};

// ── shapes ─────────────────────────────────────────────────────────────

export interface Signatory {
  name: string;
  designation?: string;
  imageUrl?: string;
}

export interface CertificateTemplate {
  id: string;
  type: CertificateType;
  name: string;
  bodyHtml: string;
  backgroundUrl: string | null;
  signatories: Signatory[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePreview {
  html: string;
  variables: Record<string, string>;
  unknownVariables: string[];
  unusedVariables: string[];
  sample: boolean;
}

export interface Certificate {
  id: string;
  studentId: string;
  type: CertificateType;
  certificateNo: string | null;
  verifyCode: string | null;
  status: CertificateStatus;
  issueKind: CertificateIssueKind;
  originalCertificateId: string | null;
  dataSnapshot: Record<string, string>;
  bodyHtml: string | null;
  isLegacy: boolean;
  clearanceOverrideBy: string | null;
  clearanceOverrideNote: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  remarks: string | null;
  student: {
    id: string;
    studentUid: string;
    firstName: string;
    lastName: string;
    status: string;
  };
  enrollment: {
    id: string;
    rollNo: number | null;
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
    session: { id: string; name: string };
  } | null;
  session: { id: string; name: string } | null;
  template: {
    id: string;
    name: string;
    type: CertificateType;
    isActive: boolean;
  } | null;
  original: {
    id: string;
    certificateNo: string | null;
    status: CertificateStatus;
  } | null;
}

export interface ClearanceBlocker {
  source: "FEES" | "LIBRARY" | "HOSTEL";
  amount: number;
  items: number;
  details: string[];
}

export interface Clearance {
  cleared: boolean;
  allowed: boolean;
  required: boolean;
  /** False when a source could not be read — `cleared` is then a guess. */
  complete: boolean;
  blockers: ClearanceBlocker[];
  totalOutstanding: number;
  warnings: string[];
  reason: string | null;
}

export interface CertificateResult {
  certificate: Certificate;
  clearance: Clearance | null;
  warnings: string[];
}

export interface PrizeWinner {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  className: string;
  position: number | null;
  gpa: number | null;
}

export interface BulkPrizeResult {
  selection: {
    classes: Array<{
      classId: string;
      className: string;
      winners: PrizeWinner[];
      note: string | null;
    }>;
    total: number;
    skipped: Array<{ classId: string; className: string; reason: string }>;
  };
  issued: Array<{
    certificateId: string;
    certificateNo: string;
    studentName: string;
    className: string;
    position: string;
  }>;
  failed: Array<{ studentName: string; reason: string }>;
  warnings: string[];
  dryRun: boolean;
}

export interface RegisterRow {
  certificateNo: string;
  type: CertificateType;
  studentName: string;
  studentUid: string;
  className: string;
  session: string;
  issueDate: string;
  issueKind: CertificateIssueKind;
  status: CertificateStatus;
  clearanceWaived: boolean;
  isLegacy: boolean;
  revokedReason: string | null;
  originalNo: string | null;
}

export interface RegisterReport {
  from: string;
  to: string;
  rows: RegisterRow[];
  totals: {
    issued: number;
    revoked: number;
    duplicates: number;
    legacy: number;
  };
}

export interface SummaryReport {
  from: string;
  to: string;
  byType: Array<{
    type: CertificateType;
    issued: number;
    revoked: number;
    total: number;
  }>;
  totals: { issued: number; revoked: number; total: number };
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  fileCount: number;
  totalFileCount: number;
  children: FolderNode[];
}

export interface ArchiveFile {
  id: string;
  folderId: string;
  title: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
  tags: string[];
  linkedType: ArchiveLinkType | null;
  linkedId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PortalCertificate {
  id: string;
  certificateNo: string;
  type: CertificateType;
  issueDate: string;
  isDuplicate: boolean;
  status: CertificateStatus;
  revokedReason: string | null;
  verifyCode: string;
  downloadable: boolean;
}

export interface CertificateVerification {
  available: boolean;
  code: string;
  outcome: VerificationOutcome;
  message: string;
  certificate?: {
    certificateNo: string;
    type: string;
    studentName: string;
    className: string | null;
    session: string | null;
    issueDate: string;
    isDuplicate: boolean;
    originalNo: string | null;
    revokedAt: string | null;
  };
}

// ── inputs ─────────────────────────────────────────────────────────────

export interface TemplateInput {
  type: CertificateType;
  name: string;
  bodyHtml: string;
  backgroundUrl?: string;
  signatories?: Signatory[];
  isActive?: boolean;
}

export interface IssueInput {
  studentId: string;
  type: CertificateType;
  templateId?: string;
  enrollmentId?: string;
  conduct?: string;
  examId?: string;
  extra?: Record<string, string>;
  remarks?: string;
  issue?: boolean;
  clearanceOverrideReason?: string;
  notify?: boolean;
  confirmTransfer?: boolean;
}

export interface LegacyInput {
  studentId: string;
  type: CertificateType;
  certificateNo: string;
  issueDate: string;
  sessionId?: string;
  remarks?: string;
  extra?: Record<string, string>;
}

export interface FileInput {
  folderId: string;
  title: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
  tags?: string[];
  linkedType?: ArchiveLinkType;
  linkedId?: string;
  notes?: string;
}

// ── helpers ────────────────────────────────────────────────────────────

/** The M25/M26 download contract, unchanged. */
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

const unwrap = <T>(res: { data: ApiEnvelope<T> }): T => res.data.data;

// ── clients ────────────────────────────────────────────────────────────

export const templateApi = {
  variables: async () =>
    unwrap<{ variables: string[] }>(
      await api.get("/certificate-templates/variables"),
    ),

  list: async (params?: {
    type?: CertificateType;
    isActive?: boolean;
    search?: string;
  }) =>
    unwrap<CertificateTemplate[]>(
      await api.get("/certificate-templates", { params }),
    ),

  get: async (id: string) =>
    unwrap<CertificateTemplate>(await api.get(`/certificate-templates/${id}`)),

  create: async (input: TemplateInput) =>
    unwrap<CertificateTemplate>(await api.post("/certificate-templates", input)),

  update: async (id: string, input: TemplateInput) =>
    unwrap<CertificateTemplate>(
      await api.put(`/certificate-templates/${id}`, input),
    ),

  remove: async (id: string) => {
    await api.delete(`/certificate-templates/${id}`);
  },

  /**
   * POST, because the designer previews unsaved editor content — markup
   * that has no id yet and is far too long for a query string.
   */
  preview: async (
    id: string | null,
    input: { studentId?: string; bodyHtml?: string },
  ) =>
    unwrap<TemplatePreview>(
      await api.post(
        id ? `/certificate-templates/${id}/preview` : "/certificate-templates/preview",
        input,
      ),
    ),
};

export const certificateApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    type?: CertificateType;
    status?: CertificateStatus;
    studentId?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Certificate[]>>("/certificates", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) =>
    unwrap<Certificate>(await api.get(`/certificates/${id}`)),

  clearance: async (studentId: string, type?: CertificateType) =>
    unwrap<Clearance>(
      await api.get("/certificates/clearance", { params: { studentId, type } }),
    ),

  create: async (input: IssueInput) =>
    unwrap<CertificateResult>(await api.post("/certificates", input)),

  issue: async (id: string, input: Partial<IssueInput>) =>
    unwrap<CertificateResult>(await api.post(`/certificates/${id}/issue`, input)),

  reissue: async (
    id: string,
    input: {
      kind: "DUPLICATE" | "CORRECTION";
      remarks?: string;
      notify?: boolean;
      clearanceOverrideReason?: string;
    },
  ) =>
    unwrap<CertificateResult>(
      await api.post(`/certificates/${id}/reissue`, input),
    ),

  revoke: async (id: string, input: { reason: string; notify?: boolean }) =>
    unwrap<CertificateResult>(
      await api.post(`/certificates/${id}/revoke`, input),
    ),

  legacy: async (input: LegacyInput) =>
    unwrap<CertificateResult>(await api.post("/certificates/legacy", input)),

  bulkPrize: async (input: {
    examId: string;
    topN: number;
    templateId?: string;
    classIds?: string[];
    dryRun?: boolean;
    issue?: boolean;
  }) => unwrap<BulkPrizeResult>(await api.post("/certificates/bulk-prize", input)),

  remove: async (id: string) => {
    await api.delete(`/certificates/${id}`);
  },

  print: (id: string, certificateNo: string | null) =>
    downloadFile(
      `/certificates/${id}/pdf`,
      `${certificateNo ?? "certificate"}.pdf`,
    ),
};

export const certificateReportApi = {
  register: async (params?: {
    from?: string;
    to?: string;
    type?: CertificateType;
  }) =>
    unwrap<RegisterReport>(
      await api.get("/certificates/reports/register", { params }),
    ),

  summary: async (params?: { from?: string; to?: string }) =>
    unwrap<SummaryReport>(
      await api.get("/certificates/reports/summary", { params }),
    ),

  downloadRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/certificates/reports/register/export${queryOf(params)}`,
      "certificate-register.xlsx",
    ),

  printRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/certificates/reports/register/pdf${queryOf(params)}`,
      "certificate-register.pdf",
    ),

  downloadSummary: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/certificates/reports/summary/export${queryOf(params)}`,
      "certificate-summary.xlsx",
    ),
};

export const archiveApi = {
  tree: async () => unwrap<FolderNode[]>(await api.get("/archive/folders")),

  tags: async () =>
    unwrap<Array<{ tag: string; count: number }>>(
      await api.get("/archive/tags"),
    ),

  createFolder: async (input: {
    name: string;
    parentId?: string | null;
    description?: string;
  }) => unwrap<FolderNode>(await api.post("/archive/folders", input)),

  updateFolder: async (
    id: string,
    input: { name: string; parentId?: string | null; description?: string },
  ) => unwrap<FolderNode>(await api.put(`/archive/folders/${id}`, input)),

  removeFolder: async (id: string) => {
    await api.delete(`/archive/folders/${id}`);
  },

  listFiles: async (params?: {
    page?: number;
    limit?: number;
    folderId?: string;
    tags?: string[];
    linkedType?: ArchiveLinkType;
    linkedId?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<ArchiveFile[]>>("/archive/files", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  createFile: async (input: FileInput) =>
    unwrap<ArchiveFile>(await api.post("/archive/files", input)),

  updateFile: async (
    id: string,
    input: {
      folderId?: string;
      title?: string;
      tags?: string[];
      linkedType?: ArchiveLinkType;
      linkedId?: string;
      notes?: string;
    },
  ) => unwrap<ArchiveFile>(await api.patch(`/archive/files/${id}`, input)),

  removeFile: async (id: string) => {
    await api.delete(`/archive/files/${id}`);
  },

  downloadUrl: async (id: string) =>
    unwrap<{ url: string }>(await api.get(`/archive/files/${id}/download`)),
};

export const certificatePortalApi = {
  mine: async () =>
    unwrap<PortalCertificate[]>(await api.get("/portal/certificates")),

  forChild: async (childId: string) =>
    unwrap<PortalCertificate[]>(
      await api.get(`/portal/parent/child/${childId}/certificates`),
    ),
};

function queryOf(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  return entries.length
    ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`
    : "";
}
