import { api, ApiEnvelope, PaginationMeta } from "./axios";
import type { Gender, StaffStatus, StaffDocumentType, UserStatus, UserType } from "./staff";

/** Mirrors the backend teacher API shapes (Module 08). */

export type TeacherDesignation =
  | "HEAD_TEACHER"
  | "ASSISTANT_HEAD"
  | "SENIOR_TEACHER"
  | "ASSISTANT_TEACHER"
  | "SUBJECT_TEACHER"
  | "PART_TIME";

export type LeaveType = "CASUAL" | "SICK" | "MATERNITY" | "UNPAID" | "OTHER";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export const TEACHER_DESIGNATION_LABELS: Record<TeacherDesignation, string> = {
  HEAD_TEACHER: "Head Teacher",
  ASSISTANT_HEAD: "Assistant Head",
  SENIOR_TEACHER: "Senior Teacher",
  ASSISTANT_TEACHER: "Assistant Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  PART_TIME: "Part-time",
};

export interface TeacherSubjectRef {
  id: string;
  name: string;
  code: string;
}

export interface Teacher {
  id: string;
  userId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  designation: TeacherDesignation;
  departmentId: string | null;
  gender: Gender;
  dob: string;
  bloodGroup: string | null;
  nidNumber: string | null;
  photoUrl: string | null;
  address: { present?: string; permanent?: string };
  joiningDate: string;
  salaryGrade: string | null;
  mpoIndexNo: string | null;
  specialization: string | null;
  status: StaffStatus;
  createdAt: string;
  updatedAt: string;
  department: { id: string; name: string; code: string } | null;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    status: UserStatus;
    userType: UserType;
    lastLoginAt: string | null;
    mustChangePassword: boolean;
  };
  subjects: Array<{ subject: TeacherSubjectRef }>;
}

export interface TeacherDetail extends Teacher {
  photoSignedUrl: string | null;
}

export interface TeacherInput {
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  nameBn?: string;
  designation: TeacherDesignation;
  departmentId?: string;
  gender: Gender;
  dob: string;
  bloodGroup?: string;
  nidNumber?: string;
  address?: { present?: string; permanent?: string };
  joiningDate: string;
  salaryGrade?: string;
  mpoIndexNo?: string;
  specialization?: string;
}

export interface TeacherListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  designation?: TeacherDesignation;
  departmentId?: string;
  status?: StaffStatus;
  subjectId?: string;
}

export interface Qualification {
  id: string;
  degree: string;
  institution: string;
  passingYear: number;
  result: string | null;
}

export interface Assignment {
  id: string;
  sessionId: string;
  teacherId: string;
  sectionId: string;
  subjectId: string;
  teacher: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
  };
  section: {
    id: string;
    name: string;
    roomNo: string | null;
    class: { id: string; name: string; numericLevel: number };
    shift: { id: string; name: string } | null;
  };
  subject: TeacherSubjectRef;
}

export interface WorkloadRow {
  teacherId: string;
  employeeId: string;
  name: string;
  designation: string;
  assignments: number;
}

export interface TeacherLeave {
  id: string;
  teacherId: string;
  fromDate: string;
  toDate: string;
  type: LeaveType;
  status: LeaveStatus;
  reason: string | null;
  createdAt: string;
  teacher?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
  };
}

export interface TeacherEvaluation {
  id: string;
  sessionId: string;
  evaluatorId: string;
  criteria: Record<string, number>;
  score: string | number;
  remarks: string | null;
  evaluatedAt: string;
}

export interface TeacherDocument {
  id: string;
  teacherId: string;
  title: string;
  type: StaffDocumentType;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl: string;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

export const teachersApi = {
  async list(
    query: TeacherListQuery = {},
  ): Promise<{ data: Teacher[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<Teacher[]>>("/teachers", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<TeacherDetail> {
    const res = await api.get<ApiEnvelope<TeacherDetail>>(`/teachers/${id}`);
    return res.data.data;
  },

  async create(input: TeacherInput): Promise<Teacher> {
    const res = await api.post<ApiEnvelope<Teacher>>("/teachers", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<TeacherInput>): Promise<Teacher> {
    const res = await api.put<ApiEnvelope<Teacher>>(`/teachers/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/teachers/${id}`);
  },

  async updateStatus(
    id: string,
    input: { status: StaffStatus; reason: string },
  ): Promise<Teacher> {
    const res = await api.put<ApiEnvelope<Teacher>>(
      `/teachers/${id}/status`,
      input,
    );
    return res.data.data;
  },

  async uploadPhoto(id: string, file: File): Promise<TeacherDetail> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<TeacherDetail>>(
      `/teachers/${id}/photo`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  // ── qualifications ──────────────────────────────────────────────

  async listQualifications(id: string): Promise<Qualification[]> {
    const res = await api.get<ApiEnvelope<Qualification[]>>(
      `/teachers/${id}/qualifications`,
    );
    return res.data.data;
  },

  async addQualification(
    id: string,
    input: {
      degree: string;
      institution: string;
      passingYear: number;
      result?: string;
    },
  ): Promise<Qualification> {
    const res = await api.post<ApiEnvelope<Qualification>>(
      `/teachers/${id}/qualifications`,
      input,
    );
    return res.data.data;
  },

  async updateQualification(
    id: string,
    qid: string,
    input: Partial<{
      degree: string;
      institution: string;
      passingYear: number;
      result?: string;
    }>,
  ): Promise<Qualification> {
    const res = await api.put<ApiEnvelope<Qualification>>(
      `/teachers/${id}/qualifications/${qid}`,
      input,
    );
    return res.data.data;
  },

  async removeQualification(id: string, qid: string): Promise<void> {
    await api.delete(`/teachers/${id}/qualifications/${qid}`);
  },

  // ── expertise ───────────────────────────────────────────────────

  async getSubjects(id: string): Promise<TeacherSubjectRef[]> {
    const res = await api.get<ApiEnvelope<TeacherSubjectRef[]>>(
      `/teachers/${id}/subjects`,
    );
    return res.data.data;
  },

  async setSubjects(
    id: string,
    subjectIds: string[],
  ): Promise<TeacherSubjectRef[]> {
    const res = await api.put<ApiEnvelope<TeacherSubjectRef[]>>(
      `/teachers/${id}/subjects`,
      { subjectIds },
    );
    return res.data.data;
  },

  // ── schedule / evaluations / documents ──────────────────────────

  async schedule(id: string, sessionId: string): Promise<Assignment[]> {
    const res = await api.get<ApiEnvelope<Assignment[]>>(
      `/teachers/${id}/schedule`,
      { params: { sessionId } },
    );
    return res.data.data;
  },

  async listEvaluations(
    id: string,
    sessionId?: string,
  ): Promise<TeacherEvaluation[]> {
    const res = await api.get<ApiEnvelope<TeacherEvaluation[]>>(
      `/teachers/${id}/evaluations`,
      { params: params({ sessionId }) },
    );
    return res.data.data;
  },

  async createEvaluation(
    id: string,
    input: {
      sessionId: string;
      criteria: Record<string, number>;
      score: number;
      remarks?: string;
      evaluatedAt: string;
    },
  ): Promise<TeacherEvaluation> {
    const res = await api.post<ApiEnvelope<TeacherEvaluation>>(
      `/teachers/${id}/evaluations`,
      input,
    );
    return res.data.data;
  },

  async removeEvaluation(id: string, eid: string): Promise<void> {
    await api.delete(`/teachers/${id}/evaluations/${eid}`);
  },

  async listDocuments(id: string): Promise<TeacherDocument[]> {
    const res = await api.get<ApiEnvelope<TeacherDocument[]>>(
      `/teachers/${id}/documents`,
    );
    return res.data.data;
  },

  async uploadDocument(
    id: string,
    input: { title: string; type: StaffDocumentType; file: File },
  ): Promise<TeacherDocument> {
    const form = new FormData();
    form.append("file", input.file);
    form.append("title", input.title);
    form.append("type", input.type);
    const res = await api.post<ApiEnvelope<TeacherDocument>>(
      `/teachers/${id}/documents`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async removeDocument(id: string, docId: string): Promise<void> {
    await api.delete(`/teachers/${id}/documents/${docId}`);
  },
};

export const teacherAssignmentsApi = {
  async list(query: {
    sessionId: string;
    sectionId?: string;
    teacherId?: string;
  }): Promise<Assignment[]> {
    const res = await api.get<ApiEnvelope<Assignment[]>>(
      "/teacher-assignments",
      { params: params(query) },
    );
    return res.data.data;
  },

  async assign(input: {
    sessionId: string;
    sectionId: string;
    subjectId: string;
    teacherId: string;
    override?: boolean;
  }): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      "/teacher-assignments",
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/teacher-assignments/${id}`);
  },

  async transfer(input: {
    fromTeacherId: string;
    toTeacherId: string;
    sessionId: string;
    override?: boolean;
  }): Promise<{ transferred: number }> {
    const res = await api.post<ApiEnvelope<{ transferred: number }>>(
      "/teacher-assignments/transfer",
      input,
    );
    return res.data.data;
  },

  async workload(sessionId: string): Promise<WorkloadRow[]> {
    const res = await api.get<ApiEnvelope<WorkloadRow[]>>(
      "/teacher-assignments/workload",
      { params: { sessionId } },
    );
    return res.data.data;
  },
};

export const teacherLeavesApi = {
  async list(query: {
    page?: number;
    limit?: number;
    search?: string;
    teacherId?: string;
    status?: LeaveStatus;
    type?: LeaveType;
  }): Promise<{ data: TeacherLeave[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<TeacherLeave[]>>("/teacher-leaves", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async create(input: {
    teacherId: string;
    fromDate: string;
    toDate: string;
    type?: LeaveType;
    reason?: string;
  }): Promise<TeacherLeave> {
    const res = await api.post<ApiEnvelope<TeacherLeave>>(
      "/teacher-leaves",
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/teacher-leaves/${id}`);
  },

  async approve(id: string): Promise<TeacherLeave> {
    const res = await api.post<ApiEnvelope<TeacherLeave>>(
      `/teacher-leaves/${id}/approve`,
    );
    return res.data.data;
  },

  async reject(id: string): Promise<TeacherLeave> {
    const res = await api.post<ApiEnvelope<TeacherLeave>>(
      `/teacher-leaves/${id}/reject`,
    );
    return res.data.data;
  },
};
