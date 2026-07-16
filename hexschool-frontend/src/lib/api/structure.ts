import { api, ApiEnvelope, PaginationMeta } from "./axios";

/** Mirrors the backend academic-structure API shapes (Module 06). */

export type SubjectType = "THEORY" | "PRACTICAL" | "BOTH";

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface Shift {
  id: string;
  name: string;
  /** ISO datetimes on a 1970 date — use timeOf() for "HH:MM". */
  startTime: string;
  endTime: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  nameBn: string | null;
  numericLevel: number;
  displayOrder: number;
}

export interface Group {
  id: string;
  name: string;
  applicableFromLevel: number;
}

export interface Subject {
  id: string;
  name: string;
  nameBn: string | null;
  code: string;
  departmentId: string | null;
  type: SubjectType;
}

export interface Section {
  id: string;
  classId: string;
  sessionId: string;
  name: string;
  shiftId: string | null;
  groupId: string | null;
  capacity: number | null;
  roomNo: string | null;
  class?: { id: string; name: string; numericLevel: number };
  shift?: { id: string; name: string } | null;
  group?: { id: string; name: string } | null;
}

export interface ClassSubjectRow {
  id: string;
  subjectId: string;
  groupId: string | null;
  isOptional: boolean;
  fullMarksDefault: number;
  displayOrder: number;
  subject: { id: string; name: string; code: string; type: SubjectType };
  group: { id: string; name: string } | null;
}

export interface CloneReport {
  preview: boolean;
  fromSession: string;
  toSession: string;
  sections: { toCreate: number; alreadyPresent: number };
  classSubjects: { toCreate: number; alreadyPresent: number };
}

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  sessionId?: string;
  classId?: string;
}

export interface Paged<T> {
  data: T[];
  meta: PaginationMeta;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** "HH:MM" of a TIME column value. */
export const timeOf = (iso: string): string => iso.slice(11, 16);

const crud = <T, TCreate, TUpdate = Partial<TCreate>>(path: string) => ({
  async list(query: ListQuery = {}): Promise<Paged<T>> {
    const res = await api.get<ApiEnvelope<T[]>>(path, {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },
  async create(input: TCreate): Promise<T> {
    const res = await api.post<ApiEnvelope<T>>(path, input);
    return res.data.data;
  },
  async update(id: string, input: TUpdate): Promise<T> {
    const res = await api.put<ApiEnvelope<T>>(`${path}/${id}`, input);
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`${path}/${id}`);
  },
});

export const structureApi = {
  departments: crud<Department, { name: string; code: string }>("/departments"),
  shifts: crud<Shift, { name: string; startTime: string; endTime: string }>(
    "/shifts",
  ),
  classes: crud<
    SchoolClass,
    {
      name: string;
      nameBn?: string;
      numericLevel: number;
      displayOrder?: number;
    }
  >("/classes"),
  groups: crud<Group, { name: string; applicableFromLevel?: number }>(
    "/groups",
  ),
  subjects: crud<
    Subject,
    {
      name: string;
      nameBn?: string;
      code: string;
      departmentId?: string;
      type?: SubjectType;
    }
  >("/subjects"),
  sections: crud<
    Section,
    {
      classId: string;
      sessionId: string;
      name: string;
      shiftId?: string;
      groupId?: string;
      capacity?: number;
      roomNo?: string;
    },
    {
      name?: string;
      shiftId?: string | null;
      groupId?: string | null;
      capacity?: number;
      roomNo?: string;
    }
  >("/sections"),

  async getClass(id: string): Promise<SchoolClass> {
    const res = await api.get<ApiEnvelope<SchoolClass>>(`/classes/${id}`);
    return res.data.data;
  },

  async getClassSubjects(
    classId: string,
    sessionId: string,
  ): Promise<ClassSubjectRow[]> {
    const res = await api.get<ApiEnvelope<ClassSubjectRow[]>>(
      `/classes/${classId}/subjects`,
      { params: { sessionId } },
    );
    return res.data.data;
  },

  async setClassSubjects(
    classId: string,
    sessionId: string,
    subjects: Array<{
      subjectId: string;
      groupId?: string;
      isOptional?: boolean;
      fullMarksDefault?: number;
    }>,
  ): Promise<ClassSubjectRow[]> {
    const res = await api.put<ApiEnvelope<ClassSubjectRow[]>>(
      `/classes/${classId}/subjects`,
      { sessionId, subjects },
    );
    return res.data.data;
  },

  async cloneStructure(input: {
    fromSessionId: string;
    toSessionId: string;
    preview?: boolean;
  }): Promise<CloneReport> {
    const res = await api.post<ApiEnvelope<CloneReport>>(
      "/academic-structure/clone",
      input,
    );
    return res.data.data;
  },
};
