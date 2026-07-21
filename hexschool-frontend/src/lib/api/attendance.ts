import { api, ApiEnvelope, PaginationMeta } from "./axios";

/** Mirrors the backend attendance API shapes (Module 12). */

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "LEAVE"
  | "HALF_DAY"
  | "HOLIDAY";

export type AttendanceMethod = "MANUAL" | "QR" | "IMPORT" | "AUTO";
export type AttendancePersonType = "TEACHER" | "STAFF";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export type StudentLeaveAppliedBy = "GUARDIAN" | "ADMIN";

export type AttendanceCounts = Record<AttendanceStatus, number>;

export interface AttendanceSummary {
  workingDays: number;
  presentEquivalent: number;
  markedDays: number;
  unmarkedDays: number;
  percentage: number;
  counts: AttendanceCounts;
}

export interface HolidayInfo {
  holiday: boolean;
  reason?: "WEEKLY" | "RANGE";
  title?: string;
}

export interface AttendanceSheetRow {
  enrollmentId: string;
  rollNo: number;
  student: {
    id: string;
    studentUid: string;
    firstName: string;
    lastName: string;
    nameBn: string | null;
    photoUrl: string | null;
  };
  enrollmentDate: string;
  status: AttendanceStatus | null;
  checkInTime: string | null;
  remarks: string | null;
  method: AttendanceMethod | null;
  onApprovedLeave: boolean;
  beforeEnrollment: boolean;
}

export interface AttendanceSheet {
  section: { id: string; name: string; className: string; sessionId: string };
  date: string;
  periodId: string | null;
  holiday: HolidayInfo;
  marked: boolean;
  editable: boolean;
  lockReason?: string;
  rows: AttendanceSheetRow[];
}

export interface MarkResult {
  saved: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
  leaveOverrides: number;
}

export interface QrCheckinResult {
  marked: boolean;
  alreadyMarked: boolean;
  status: AttendanceStatus;
  minutesLate: number;
  date: string;
  student: {
    id: string;
    studentUid: string;
    name: string;
    photoUrl: string | null;
    className: string;
    sectionName: string;
    rollNo: number;
  };
}

export interface StaffAttendanceRow {
  personType: AttendancePersonType;
  personId: string;
  employeeId: string;
  name: string;
  designation: string;
  departmentId: string | null;
  status: AttendanceStatus | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  remarks: string | null;
}

export interface StaffAttendanceSheet {
  date: string;
  holiday: HolidayInfo;
  marked: boolean;
  editable: boolean;
  lockReason?: string;
  rows: StaffAttendanceRow[];
}

export interface StudentLeave {
  id: string;
  studentId: string;
  sessionId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  appliedBy: StudentLeaveAppliedBy;
  status: LeaveStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  student: {
    id: string;
    studentUid: string;
    firstName: string;
    lastName: string;
    nameBn: string | null;
    photoUrl: string | null;
  };
  session: { id: string; name: string };
}

// ── reports ─────────────────────────────────────────────────────────

export interface SectionDailyRow {
  sectionId: string;
  sectionName: string;
  className: string;
  enrolled: number;
  marked: number;
  counts: AttendanceCounts;
  percentage: number;
}

export interface DailyReport {
  date: string;
  holiday: HolidayInfo;
  sections: SectionDailyRow[];
  totals: {
    enrolled: number;
    marked: number;
    counts: AttendanceCounts;
    percentage: number;
  };
  students?: Array<{
    rollNo: number;
    studentUid: string;
    name: string;
    status: AttendanceStatus | null;
    remarks: string | null;
  }>;
}

export interface MonthlyRegister {
  section: { id: string; name: string; className: string };
  month: string;
  days: string[];
  rows: Array<{
    enrollmentId: string;
    rollNo: number;
    studentUid: string;
    name: string;
    marks: Record<string, AttendanceStatus>;
    summary: AttendanceSummary;
  }>;
}

export interface StudentAttendanceReport {
  student: { id: string; studentUid: string; name: string };
  from: string;
  to: string;
  summary: AttendanceSummary;
  bySection: Array<{
    sectionId: string;
    sectionName: string;
    className: string;
    counts: AttendanceCounts;
    percentage: number;
  }>;
  entries: Array<{
    date: string;
    status: AttendanceStatus;
    sectionName: string;
    remarks: string | null;
  }>;
}

export interface StaffMonthlyReport {
  month: string;
  days: string[];
  rows: Array<{
    personType: AttendancePersonType;
    personId: string;
    employeeId: string;
    name: string;
    marks: Record<string, AttendanceStatus>;
    summary: AttendanceSummary;
  }>;
}

export interface AttendanceSummaryReport {
  from: string;
  to: string;
  workingDays: number;
  overall: AttendanceSummary;
  sections: SectionDailyRow[];
  trend: Array<{ date: string; percentage: number }>;
}

export interface LateAnalysisReport {
  month: string;
  threshold: number;
  rows: Array<{
    studentUid: string;
    name: string;
    sectionName: string;
    lateDays: number;
    dates: string[];
    flagged: boolean;
  }>;
}

export type ReportFormat = "xlsx" | "pdf";

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams an export endpoint straight to a browser download. */
async function download(path: string, query: object): Promise<void> {
  const res = await api.get<Blob>(path, {
    params: params(query),
    responseType: "blob",
  });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? "attendance-report";
  link.click();
  URL.revokeObjectURL(url);
}

export const attendanceApi = {
  async sheet(
    sectionId: string,
    date: string,
    periodId?: string,
  ): Promise<AttendanceSheet> {
    const res = await api.get<ApiEnvelope<AttendanceSheet>>(
      "/attendance/students",
      { params: params({ sectionId, date, periodId }) },
    );
    return res.data.data;
  },

  async mark(input: {
    sectionId: string;
    date: string;
    periodId?: string;
    entries: Array<{
      enrollmentId: string;
      status: AttendanceStatus;
      remarks?: string;
    }>;
    overrideHoliday?: boolean;
  }): Promise<MarkResult> {
    const res = await api.post<ApiEnvelope<MarkResult>>(
      "/attendance/students",
      input,
    );
    return res.data.data;
  },

  async qrCheckin(qrToken: string): Promise<QrCheckinResult> {
    const res = await api.post<ApiEnvelope<QrCheckinResult>>(
      "/attendance/qr-checkin",
      { qrToken },
    );
    return res.data.data;
  },

  async convertToHoliday(input: {
    date: string;
    sectionId?: string;
    reason: string;
  }): Promise<{ converted: number }> {
    const res = await api.post<ApiEnvelope<{ converted: number }>>(
      "/attendance/convert-holiday",
      input,
    );
    return res.data.data;
  },

  async staffSheet(
    date: string,
    personType?: AttendancePersonType,
  ): Promise<StaffAttendanceSheet> {
    const res = await api.get<ApiEnvelope<StaffAttendanceSheet>>(
      "/attendance/staff",
      { params: params({ date, personType }) },
    );
    return res.data.data;
  },

  async markStaff(input: {
    date: string;
    entries: Array<{
      personType: AttendancePersonType;
      personId: string;
      status: AttendanceStatus;
      remarks?: string;
    }>;
    overrideHoliday?: boolean;
  }): Promise<{ saved: number }> {
    const res = await api.post<ApiEnvelope<{ saved: number }>>(
      "/attendance/staff",
      input,
    );
    return res.data.data;
  },
};

export const studentLeaveApi = {
  async list(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: LeaveStatus;
      studentId?: string;
      sessionId?: string;
    } = {},
  ): Promise<{ data: StudentLeave[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<StudentLeave[]>>("/student-leaves", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async create(input: {
    studentId: string;
    sessionId?: string;
    fromDate: string;
    toDate: string;
    reason: string;
  }): Promise<StudentLeave> {
    const res = await api.post<ApiEnvelope<StudentLeave>>(
      "/student-leaves",
      input,
    );
    return res.data.data;
  },

  async approve(
    id: string,
    note?: string,
  ): Promise<{ leave: StudentLeave; correctedDays: number }> {
    const res = await api.post<
      ApiEnvelope<{ leave: StudentLeave; correctedDays: number }>
    >(`/student-leaves/${id}/approve`, { note });
    return res.data.data;
  },

  async reject(id: string, note?: string): Promise<StudentLeave> {
    const res = await api.post<ApiEnvelope<StudentLeave>>(
      `/student-leaves/${id}/reject`,
      { note },
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/student-leaves/${id}`);
  },
};

export const attendanceReportApi = {
  async daily(query: {
    date: string;
    sectionId?: string;
    sessionId?: string;
  }): Promise<DailyReport> {
    const res = await api.get<ApiEnvelope<DailyReport>>(
      "/attendance/reports/daily",
      { params: params(query) },
    );
    return res.data.data;
  },

  async monthly(query: {
    sectionId: string;
    month: string;
  }): Promise<MonthlyRegister> {
    const res = await api.get<ApiEnvelope<MonthlyRegister>>(
      "/attendance/reports/monthly",
      { params: params(query) },
    );
    return res.data.data;
  },

  async student(
    studentId: string,
    query: { sessionId?: string; from?: string; to?: string } = {},
  ): Promise<StudentAttendanceReport> {
    const res = await api.get<ApiEnvelope<StudentAttendanceReport>>(
      `/attendance/reports/student/${studentId}`,
      { params: params(query) },
    );
    return res.data.data;
  },

  async staff(query: {
    month: string;
    personType?: AttendancePersonType;
  }): Promise<StaffMonthlyReport> {
    const res = await api.get<ApiEnvelope<StaffMonthlyReport>>(
      "/attendance/reports/staff",
      { params: params(query) },
    );
    return res.data.data;
  },

  async summary(
    query: {
      sessionId?: string;
      from?: string;
      to?: string;
      classId?: string;
    } = {},
  ): Promise<AttendanceSummaryReport> {
    const res = await api.get<ApiEnvelope<AttendanceSummaryReport>>(
      "/attendance/reports/summary",
      { params: params(query) },
    );
    return res.data.data;
  },

  async lateAnalysis(query: {
    month: string;
    sessionId?: string;
    sectionId?: string;
  }): Promise<LateAnalysisReport> {
    const res = await api.get<ApiEnvelope<LateAnalysisReport>>(
      "/attendance/reports/late-analysis",
      { params: params(query) },
    );
    return res.data.data;
  },

  /** `report` picks the endpoint; the browser saves the returned file. */
  download(
    report: "daily" | "monthly" | "staff" | "summary" | "late-analysis",
    query: object,
    format: ReportFormat,
  ): Promise<void> {
    return download(`/attendance/reports/${report}/export`, {
      ...query,
      format,
    });
  },

  downloadStudent(
    studentId: string,
    query: object,
    format: ReportFormat,
  ): Promise<void> {
    return download(`/attendance/reports/student/${studentId}/export`, {
      ...query,
      format,
    });
  },
};
