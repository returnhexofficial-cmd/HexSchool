import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Portal + Dashboard + Reports API (Module 18). Portal
 * reads are me-scoped server-side (ownership, not permissions); a parent
 * passes a `childId` the API verifies belongs to them.
 */

// ── portal principal ────────────────────────────────────────────────────

export interface PortalChild {
  studentId: string;
  name: string;
  studentUid: string;
  status: string;
  photoUrl: string | null;
}

export interface PortalPrincipal {
  userId: string;
  userType: "STUDENT" | "PARENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN" | "STAFF";
  studentId: string | null;
  guardianId: string | null;
  teacherId: string | null;
  children: PortalChild[];
}

// ── student overview ────────────────────────────────────────────────────

export interface StudentOverview {
  student: { id: string; name: string; studentUid: string; status: string; photoUrl: string | null };
  enrollment: {
    className: string;
    sectionName: string;
    rollNo: number;
    groupName: string | null;
    shiftName: string | null;
  } | null;
  attendance: { percentage: number; markedDays: number; present: number; absent: number };
  result: {
    examName: string;
    gpa: number;
    grade: string;
    meritPositionClass: number | null;
  } | null;
  averageGpa: number;
  dues: { outstanding: number; totalBilled: number };
  todayPeriods: Array<{ subject: string; teacher: string; roomNo: string | null; time: string }>;
  notices: Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }>;
}

export interface PerformanceHistory {
  available: boolean;
  items: Array<{
    examId: string;
    enrollmentId: string;
    examName: string;
    className: string;
    rollNo: number;
    gpa: number;
    grade: string;
    status: string;
    obtainedMarks: number;
    totalMarks: number;
    meritPositionClass: number | null;
    publishedAt: string | null;
  }>;
  averageGpa: number;
  examsPublished: number;
}

export interface AttendanceHistory {
  available: boolean;
  counts: Record<string, number>;
  markedDays: number;
  percentage: number;
  items: Array<{ date: string; status: string; sectionId: string; remarks: string | null }>;
}

export interface PayableInvoice {
  id: string;
  invoiceNo: string;
  dueDate: string;
  payable: number;
  paidTotal: number;
  outstanding: number;
  status: string;
}

export interface StudentLedger {
  studentId: string;
  entries: Array<{
    date: string;
    type: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  /** What Pay Now may be pointed at (M16 §5 portal payment). */
  payableInvoices: PayableInvoice[];
}

/**
 * The outcome of a gateway checkout. Read from our own payment rows — the
 * M16 server-side `verify()` is the only thing that concludes SUCCESS, so
 * the gateway's redirect parameters never influence what this says.
 */
export interface PaymentStatus {
  reference: string;
  outcome: "SUCCESS" | "PARTIAL" | "PENDING" | "FAILED";
  total: number;
  payments: Array<{
    id: string;
    paymentNo: string;
    invoiceNo: string;
    amount: number;
    method: string;
    status: string;
    paidAt: string | null;
  }>;
}

// ── routine / profile / documents / messages ────────────────────────────

export interface PortalRoutine {
  available: boolean;
  reason?: string;
  slots?: Array<{ id: string; name: string; startTime: string; endTime: string }>;
  cells?: Array<{
    day: string;
    periodSlotId: string;
    subject: { id: string; name: string };
    teacher: { id: string; name: string };
    roomNo: string | null;
  }>;
}

export interface StudentProfile {
  student: {
    id: string;
    name: string;
    studentUid: string;
    status: string;
    dob: string;
    gender: string;
    religion: string | null;
    bloodGroup: string | null;
    admissionDate: string;
    presentAddress: string | null;
    permanentAddress: string | null;
    photoUrl: string | null;
  };
  contact: { email: string | null; phone: string | null };
  guardians: Array<{
    id: string;
    name: string;
    relation: string;
    phone: string;
    isPrimary: boolean;
  }>;
  enrollment: StudentOverview["enrollment"];
}

export interface StudentDocuments {
  documents: Array<{
    id: string;
    title: string;
    type: string;
    sizeBytes: number;
    createdAt: string;
    signedUrl: string;
  }>;
  /** Module 27 replaces this self-describing stub. */
  certificates: { available: boolean; reason: string };
}

export interface MessageHistory {
  items: Array<{
    id: string;
    channel: string;
    destination: string;
    templateCode: string | null;
    body: string;
    status: string;
    sentAt: string | null;
    createdAt: string;
  }>;
}

// ── employee leave & payslips (M21) ─────────────────────────────────────

export interface PortalLeave {
  id: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: string;
  status: string;
  reason: string;
  decisionNote: string | null;
  leaveType: { id: string; name: string; isPaid: boolean };
}

export interface PortalLeaveBalance {
  leaveType: { id: string; name: string; isPaid: boolean };
  allocated: number;
  used: number;
  carried: number;
  available: number;
}

export interface PortalPayslip {
  id: string;
  month: string;
  gross: number;
  totalDeductions: number;
  netPayable: number;
  status: string;
  paidAt: string | null;
}

export interface PortalEmployee {
  personType: "TEACHER" | "STAFF";
  personId: string;
  employeeId: string;
  name: string;
  designation: string;
  joiningDate: string;
  status: string;
}

export interface TeacherRoster {
  enrollmentId: string;
  studentId: string;
  rollNo: number;
  name: string;
  studentUid: string;
}

// ── teacher overview ────────────────────────────────────────────────────

export interface TeacherOverview {
  teacher: { id: string; name: string; employeeId: string };
  session: { id: string; name: string };
  todayPeriods: Array<{ subject: string; section: string; roomNo: string | null; time: string }>;
  periodsPerWeek: number;
  freeToday: number;
  sections: Array<{ id: string; label: string }>;
  notices: Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }>;
}

// ── dashboards ──────────────────────────────────────────────────────────

export interface AdminDashboard {
  session: { id: string; name: string } | null;
  students: { total: number; byClass: Array<{ className: string; count: number }> };
  todayAttendance: number | null;
  teacherAttendance: { present: number; total: number };
  feeCollection: { today: number; month: number; duesTotal: number };
  pendingAdmissions: number;
  recentNotices: Array<{ id: string; title: string; pinned: boolean; createdAt: string }>;
  upcomingEvents: Array<{ id: string; title: string; date: string; type: string }>;
  resultStats: {
    examName: string;
    candidates: number;
    passed: number;
    passRate: number;
    averageGpa: number;
  } | null;
  /** 30 days of daily attendance %; `null` on a day nobody marked. */
  attendanceTrend: Array<{ date: string; percentage: number | null }>;
  /** NCTB-banded GPA histogram for the latest active publication. */
  gpaDistribution: { examName: string; buckets: Array<{ label: string; count: number }> } | null;
  collectionTrend: Array<{ month: string; amount: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actor: string;
    createdAt: string;
  }>;
  cached: boolean;
}

export interface AccountantDashboard {
  feeCollection: { today: number; month: number; duesTotal: number };
  collectionByMethod: Array<{ method: string; amount: number; count: number }>;
  pendingInvoices: number;
  monthlyTrend: Array<{ month: string; amount: number }>;
  cached: boolean;
}

// ── reports ─────────────────────────────────────────────────────────────

export interface ReportDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
  permission: string;
  endpoint: string;
  params: Array<{ key: string; label: string; type: string; required: boolean }>;
  formats: string[];
}

/** Streams a portal PDF endpoint straight to a browser download (M15/M16 pattern). */
async function download(path: string, fallback: string): Promise<void> {
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

/**
 * Where the gateway sends the payer back. The M16 callback concludes the
 * payment server-side; this page only *reports* what happened, so a payer
 * who never returns (closed the bKash app) still gets credited by the
 * reconciliation sweep.
 */
function portalReturnUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/portal/payment`;
}

export const portalApi = {
  async me() {
    const res = await api.get<ApiEnvelope<PortalPrincipal>>("/portal/me");
    return res.data.data;
  },
  async studentOverview() {
    const res = await api.get<ApiEnvelope<StudentOverview>>("/portal/student/overview");
    return res.data.data;
  },
  async studentAttendance() {
    const res = await api.get<ApiEnvelope<AttendanceHistory>>("/portal/student/attendance");
    return res.data.data;
  },
  async studentResults() {
    const res = await api.get<ApiEnvelope<PerformanceHistory>>("/portal/student/results");
    return res.data.data;
  },
  async studentDues() {
    const res = await api.get<ApiEnvelope<StudentLedger>>("/portal/student/dues");
    return res.data.data;
  },
  async studentRoutine() {
    const res = await api.get<ApiEnvelope<PortalRoutine>>("/portal/student/routine");
    return res.data.data;
  },
  async studentProfile() {
    const res = await api.get<ApiEnvelope<StudentProfile>>("/portal/student/profile");
    return res.data.data;
  },
  async studentDocuments() {
    const res = await api.get<ApiEnvelope<StudentDocuments>>("/portal/student/documents");
    return res.data.data;
  },
  studentReportCard(examId: string): Promise<void> {
    return download(`/portal/student/report-card/${examId}`, "report-card.pdf");
  },
  async studentPay(invoiceIds: string[], gateway: string) {
    const res = await api.post<ApiEnvelope<{ checkoutUrl: string; gatewayRef: string }>>(
      "/portal/student/pay",
      { invoiceIds, gateway, returnUrl: portalReturnUrl() },
    );
    return res.data.data;
  },

  async parentOverview() {
    const res = await api.get<ApiEnvelope<{ children: StudentOverview[] }>>(
      "/portal/parent/overview",
    );
    return res.data.data;
  },
  async childOverview(childId: string) {
    const res = await api.get<ApiEnvelope<StudentOverview>>(
      `/portal/parent/child/${childId}/overview`,
    );
    return res.data.data;
  },
  async childAttendance(childId: string) {
    const res = await api.get<ApiEnvelope<AttendanceHistory>>(
      `/portal/parent/child/${childId}/attendance`,
    );
    return res.data.data;
  },
  async childResults(childId: string) {
    const res = await api.get<ApiEnvelope<PerformanceHistory>>(
      `/portal/parent/child/${childId}/results`,
    );
    return res.data.data;
  },
  async childDues(childId: string) {
    const res = await api.get<ApiEnvelope<StudentLedger>>(
      `/portal/parent/child/${childId}/dues`,
    );
    return res.data.data;
  },
  async childRoutine(childId: string) {
    const res = await api.get<ApiEnvelope<PortalRoutine>>(
      `/portal/parent/child/${childId}/routine`,
    );
    return res.data.data;
  },
  async childProfile(childId: string) {
    const res = await api.get<ApiEnvelope<StudentProfile>>(
      `/portal/parent/child/${childId}/profile`,
    );
    return res.data.data;
  },
  async childDocuments(childId: string) {
    const res = await api.get<ApiEnvelope<StudentDocuments>>(
      `/portal/parent/child/${childId}/documents`,
    );
    return res.data.data;
  },
  childReportCard(childId: string, examId: string): Promise<void> {
    return download(
      `/portal/parent/child/${childId}/report-card/${examId}`,
      "report-card.pdf",
    );
  },
  async childPay(childId: string, invoiceIds: string[], gateway: string) {
    const res = await api.post<ApiEnvelope<{ checkoutUrl: string; gatewayRef: string }>>(
      `/portal/parent/child/${childId}/pay`,
      { invoiceIds, gateway, returnUrl: portalReturnUrl() },
    );
    return res.data.data;
  },

  async paymentStatus(reference: string) {
    const res = await api.get<ApiEnvelope<PaymentStatus>>("/portal/payment-status", {
      params: { reference },
    });
    return res.data.data;
  },

  // ── messages (student + parent) ───────────────────────────────────────

  async messages() {
    const res = await api.get<ApiEnvelope<MessageHistory>>("/portal/messages");
    return res.data.data;
  },
  async contactSchool(body: string, subject?: string) {
    const res = await api.post<ApiEnvelope<{ message: string }>>(
      "/portal/contact-school",
      { body, ...(subject ? { subject } : {}) },
    );
    return res.data.data;
  },

  async teacherOverview() {
    const res = await api.get<ApiEnvelope<TeacherOverview>>("/portal/teacher/overview");
    return res.data.data;
  },
  async teacherRoutine() {
    const res = await api.get<ApiEnvelope<PortalRoutine>>("/portal/teacher/routine");
    return res.data.data;
  },
  async teacherRoster(sectionId: string) {
    const res = await api.get<ApiEnvelope<TeacherRoster[]>>(
      `/portal/teacher/section/${sectionId}/roster`,
    );
    return res.data.data;
  },
  // ── employee self-service (M21) ───────────────────────────────────────
  // These serve teachers AND non-teaching staff: the person is resolved
  // from the logged-in account, never from a parameter.

  async employeeMe() {
    const res = await api.get<ApiEnvelope<PortalEmployee>>(
      "/portal/employee/me",
    );
    return res.data.data;
  },
  async myLeaves() {
    const res = await api.get<ApiEnvelope<PortalLeave[]>>(
      "/portal/employee/leaves",
    );
    return res.data.data;
  },
  async myLeaveBalances() {
    const res = await api.get<ApiEnvelope<PortalLeaveBalance[]>>(
      "/portal/employee/leave-balances",
    );
    return res.data.data;
  },
  async applyForLeave(input: {
    fromDate: string;
    toDate: string;
    leaveTypeId: string;
    halfDay?: boolean;
    reason: string;
  }) {
    const res = await api.post<ApiEnvelope<PortalLeave>>(
      "/portal/employee/leaves",
      input,
    );
    return res.data.data;
  },
  async myPayslips() {
    const res = await api.get<ApiEnvelope<PortalPayslip[]>>(
      "/portal/employee/payslips",
    );
    return res.data.data;
  },
  async downloadPayslip(id: string) {
    const res = await api.get<Blob>(`/portal/employee/payslips/${id}/pdf`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payslip-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  },

  async adminDashboard() {
    const res = await api.get<ApiEnvelope<AdminDashboard>>("/dashboard/admin");
    return res.data.data;
  },
  async accountantDashboard() {
    const res = await api.get<ApiEnvelope<AccountantDashboard>>("/dashboard/accountant");
    return res.data.data;
  },
  async withholdDuesResults(examId: string) {
    const res = await api.post<ApiEnvelope<{ withheld: number; skipped: number }>>(
      "/dashboard/withhold-dues-results",
      { examId },
    );
    return res.data.data;
  },
  async sendDuesReminders(sessionId?: string) {
    const res = await api.post<ApiEnvelope<{ sent: number; recipients: number }>>(
      "/dashboard/dues-reminders",
      sessionId ? { sessionId } : {},
    );
    return res.data.data;
  },

  async reports() {
    const res = await api.get<ApiEnvelope<ReportDefinition[]>>("/reports");
    return res.data.data;
  },
};

export function formatBDT(value: number): string {
  return `৳${value.toLocaleString("en-BD", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
