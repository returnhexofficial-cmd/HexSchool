import { api, ApiEnvelope } from "./axios";

/** Mirrors the backend school/settings/grading API shapes (Module 04). */

export type SchoolType =
  | "PRIMARY"
  | "HIGH_SCHOOL"
  | "KINDERGARTEN"
  | "ENGLISH_VERSION"
  | "ENGLISH_MEDIUM"
  | "MADRASA"
  | "VOCATIONAL"
  | "COLLEGE";

export interface School {
  id: string;
  name: string;
  nameBn: string | null;
  code: string;
  eiinNumber: string | null;
  type: SchoolType;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Signed URL (1 h) minted by the API, or null. */
  logoUrl: string | null;
  establishedYear: number | null;
  principalName: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  updatedAt: string;
}

export type UpdateSchoolInput = Partial<
  Pick<
    School,
    | "name"
    | "nameBn"
    | "code"
    | "eiinNumber"
    | "type"
    | "address"
    | "phone"
    | "email"
    | "website"
    | "establishedYear"
    | "principalName"
  >
>;

export type SettingsGroup =
  | "general"
  | "academic"
  | "sms"
  | "email"
  | "payment"
  | "attendance"
  | "exam"
  | "fees";

export interface SettingView {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "json";
  secret: boolean;
  /** Secrets: SECRET_MASK when set, "" when never configured. */
  value: unknown;
}

/** Sending this back for a secret keeps the stored value. */
export const SECRET_MASK = "__SECRET__";

export interface GradePoint {
  grade: string;
  point: string | number; // NUMERIC arrives as string
  minMark: number;
  maxMark: number;
}

export interface GradingSystem {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt: string;
  gradePoints: GradePoint[];
}

export interface GradePointInput {
  grade: string;
  point: number;
  minMark: number;
  maxMark: number;
}

export interface TestResult {
  ok: boolean;
  detail: string;
}

export const schoolApi = {
  async get(): Promise<School> {
    const res = await api.get<ApiEnvelope<School>>("/school");
    return res.data.data;
  },

  async update(input: UpdateSchoolInput): Promise<School> {
    const res = await api.put<ApiEnvelope<School>>("/school", input);
    return res.data.data;
  },

  async uploadLogo(file: File): Promise<School> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<ApiEnvelope<School>>("/school/logo", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.data;
  },

  async getSettings(group: SettingsGroup): Promise<SettingView[]> {
    const res = await api.get<ApiEnvelope<SettingView[]>>(
      `/settings/${group}`,
    );
    return res.data.data;
  },

  async updateSettings(
    group: SettingsGroup,
    values: Record<string, unknown>,
  ): Promise<SettingView[]> {
    const res = await api.put<ApiEnvelope<SettingView[]>>(
      `/settings/${group}`,
      values,
    );
    return res.data.data;
  },

  async testEmail(to?: string): Promise<TestResult> {
    const res = await api.post<ApiEnvelope<TestResult>>(
      "/settings/test-email",
      to ? { to } : {},
    );
    return res.data.data;
  },

  async testSms(to?: string): Promise<TestResult> {
    const res = await api.post<ApiEnvelope<TestResult>>(
      "/settings/test-sms",
      to ? { to } : {},
    );
    return res.data.data;
  },

  async listGradingSystems(): Promise<GradingSystem[]> {
    const res = await api.get<ApiEnvelope<GradingSystem[]>>(
      "/grading-systems",
    );
    return res.data.data;
  },

  async createGradingSystem(input: {
    name: string;
    isDefault?: boolean;
    gradePoints: GradePointInput[];
  }): Promise<GradingSystem> {
    const res = await api.post<ApiEnvelope<GradingSystem>>(
      "/grading-systems",
      input,
    );
    return res.data.data;
  },

  async updateGradingSystem(
    id: string,
    input: {
      name?: string;
      isDefault?: boolean;
      gradePoints?: GradePointInput[];
    },
  ): Promise<GradingSystem> {
    const res = await api.put<ApiEnvelope<GradingSystem>>(
      `/grading-systems/${id}`,
      input,
    );
    return res.data.data;
  },

  async deleteGradingSystem(id: string): Promise<void> {
    await api.delete(`/grading-systems/${id}`);
  },
};
