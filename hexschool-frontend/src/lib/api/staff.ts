import { api, ApiEnvelope, PaginationMeta } from "./axios";

/** Mirrors the backend staff & user-admin API shapes (Module 07). */

export type StaffDesignation =
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "ACCOUNTANT"
  | "ADMISSION_OFFICER"
  | "LIBRARIAN"
  | "OFFICE_STAFF"
  | "LAB_ASSISTANT"
  | "SECURITY"
  | "CLEANER"
  | "OTHER";

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type EmploymentType = "PERMANENT" | "CONTRACT" | "PART_TIME";
export type StaffStatus =
  | "ACTIVE"
  | "ON_LEAVE"
  | "RESIGNED"
  | "TERMINATED"
  | "RETIRED";
export type StaffDocumentType =
  | "NID"
  | "CERTIFICATE"
  | "CV"
  | "PHOTO"
  | "CONTRACT"
  | "OTHER";
export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PENDING";
export type UserType =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "STAFF"
  | "TEACHER"
  | "STUDENT"
  | "PARENT";

export const DESIGNATION_LABELS: Record<StaffDesignation, string> = {
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  ACCOUNTANT: "Accountant",
  ADMISSION_OFFICER: "Admission Officer",
  LIBRARIAN: "Librarian",
  OFFICE_STAFF: "Office Staff",
  LAB_ASSISTANT: "Lab Assistant",
  SECURITY: "Security",
  CLEANER: "Cleaner",
  OTHER: "Other",
};

export interface StaffMember {
  id: string;
  userId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  nameBn: string | null;
  designation: StaffDesignation;
  departmentId: string | null;
  gender: Gender;
  /** YYYY-MM-DD (date columns serialize as ISO midnight). */
  dob: string;
  bloodGroup: string | null;
  nidNumber: string | null;
  photoUrl: string | null;
  address: { present?: string; permanent?: string };
  joiningDate: string;
  employmentType: EmploymentType;
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
}

export interface StaffDetail extends StaffMember {
  photoSignedUrl: string | null;
}

export interface StaffDocument {
  id: string;
  staffId: string;
  title: string;
  type: StaffDocumentType;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl: string;
}

export interface StaffInput {
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  nameBn?: string;
  designation: StaffDesignation;
  departmentId?: string;
  gender: Gender;
  dob: string;
  bloodGroup?: string;
  nidNumber?: string;
  address?: { present?: string; permanent?: string };
  joiningDate: string;
  employmentType?: EmploymentType;
}

export interface StaffListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  designation?: StaffDesignation;
  departmentId?: string;
  status?: StaffStatus;
}

export interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  userType: UserType;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Array<{ id: string; name: string; slug: string }>;
  staffProfile: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  } | null;
}

export interface UsersListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  userType?: UserType;
  status?: UserStatus;
  roleId?: string;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

export const staffApi = {
  async list(
    query: StaffListQuery = {},
  ): Promise<{ data: StaffMember[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<StaffMember[]>>("/staff", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async get(id: string): Promise<StaffDetail> {
    const res = await api.get<ApiEnvelope<StaffDetail>>(`/staff/${id}`);
    return res.data.data;
  },

  async create(input: StaffInput): Promise<StaffMember> {
    const res = await api.post<ApiEnvelope<StaffMember>>("/staff", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<StaffInput>): Promise<StaffMember> {
    const res = await api.put<ApiEnvelope<StaffMember>>(`/staff/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/staff/${id}`);
  },

  async updateStatus(
    id: string,
    input: { status: StaffStatus; reason: string },
  ): Promise<StaffMember> {
    const res = await api.put<ApiEnvelope<StaffMember>>(
      `/staff/${id}/status`,
      input,
    );
    return res.data.data;
  },

  /** Soft duplicate check — the form warns, never blocks. */
  async checkNid(nid: string, excludeId?: string): Promise<boolean> {
    const res = await api.get<ApiEnvelope<{ exists: boolean }>>(
      "/staff/check-nid",
      { params: params({ nid, excludeId }) },
    );
    return res.data.data.exists;
  },

  async uploadPhoto(id: string, file: File): Promise<StaffDetail> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<StaffDetail>>(
      `/staff/${id}/photo`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async listDocuments(id: string): Promise<StaffDocument[]> {
    const res = await api.get<ApiEnvelope<StaffDocument[]>>(
      `/staff/${id}/documents`,
    );
    return res.data.data;
  },

  async uploadDocument(
    id: string,
    input: { title: string; type: StaffDocumentType; file: File },
  ): Promise<StaffDocument> {
    const form = new FormData();
    form.append("file", input.file);
    form.append("title", input.title);
    form.append("type", input.type);
    const res = await api.post<ApiEnvelope<StaffDocument>>(
      `/staff/${id}/documents`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async removeDocument(id: string, docId: string): Promise<void> {
    await api.delete(`/staff/${id}/documents/${docId}`);
  },
};

export const usersApi = {
  async list(
    query: UsersListQuery = {},
  ): Promise<{ data: AdminUser[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<AdminUser[]>>("/users", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async updateStatus(
    id: string,
    input: { status: UserStatus; reason?: string },
  ): Promise<void> {
    await api.put(`/users/${id}/status`, input);
  },

  async resetPassword(id: string): Promise<{ tempPassword: string }> {
    const res = await api.post<ApiEnvelope<{ tempPassword: string }>>(
      `/users/${id}/reset-password`,
    );
    return res.data.data;
  },
};
