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
    const res = await api.get<ApiEnvelope<Record<string, unknown>>>("/portal/student/routine");
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

  async teacherOverview() {
    const res = await api.get<ApiEnvelope<TeacherOverview>>("/portal/teacher/overview");
    return res.data.data;
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
