import { api, ApiEnvelope } from "./axios";

/** Mirrors the backend timetable API shapes (Module 13). */

export type PeriodSlotType = "CLASS" | "BREAK" | "ASSEMBLY";
export type TimetableStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type Weekday = "SAT" | "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI";

export type ConflictKind =
  | "TEACHER"
  | "ROOM"
  | "DUPLICATE_CELL"
  | "TEACHER_DAILY_CAP";

export interface RoutineConflict {
  kind: ConflictKind;
  day: Weekday;
  slotId: string;
  sectionId: string;
  message: string;
  clashesWith?: {
    sectionId: string;
    sectionLabel: string;
    slotName: string;
    teacherId: string;
    roomNo: string | null;
  };
}

export interface PeriodSlot {
  id: string;
  shiftId: string;
  shiftName?: string;
  name: string;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  type: PeriodSlotType;
  displayOrder: number;
}

export interface RoutineSlotRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  type: PeriodSlotType;
  displayOrder: number;
}

export interface RoutineCell {
  entryId: string;
  day: Weekday;
  periodSlotId: string;
  subject: { id: string; name: string; code: string };
  teacher: { id: string; name: string; employeeId: string };
  roomNo: string | null;
  combinedWith: { id: string; label: string } | null;
}

export interface TimetableSummary {
  id: string;
  sessionId: string;
  sectionId: string;
  status: TimetableStatus;
  version: number;
  effectiveFrom: string;
  publishedAt: string | null;
  notes: string | null;
  section: {
    id: string;
    name: string;
    roomNo: string | null;
    class: { id: string; name: string; numericLevel: number };
    shift: { id: string; name: string } | null;
  };
  session: { id: string; name: string };
}

export interface TimetableEntryRow {
  id: string;
  day: Weekday;
  periodSlotId: string;
  subjectId: string;
  teacherId: string;
  roomNo: string | null;
  combinedWithSectionId: string | null;
  subject: { id: string; name: string; code: string };
  teacher: { id: string; firstName: string; lastName: string };
  periodSlot: RoutineSlotRow;
  combinedWithSection: { id: string; name: string } | null;
}

export interface TimetableDetail {
  timetable: TimetableSummary;
  slots: Array<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    type: PeriodSlotType;
    displayOrder: number;
  }>;
  days: Weekday[];
  entries: TimetableEntryRow[];
  conflicts: RoutineConflict[];
}

export interface SectionRoutine {
  section: {
    id: string;
    name: string;
    className: string;
    shiftName: string | null;
    roomNo: string | null;
  };
  session: { id: string; name: string };
  timetable: {
    id: string;
    status: TimetableStatus;
    version: number;
    effectiveFrom: string;
    publishedAt: string | null;
  } | null;
  days: Weekday[];
  slots: RoutineSlotRow[];
  cells: RoutineCell[];
}

export interface TeacherRoutine {
  teacher: { id: string; name: string; employeeId: string };
  session: { id: string; name: string };
  days: Weekday[];
  slots: RoutineSlotRow[];
  cells: Array<RoutineCell & { sectionId: string; sectionLabel: string }>;
  periodsPerWeek: number;
  freeByDay: Record<string, number>;
}

export interface MasterRoutine {
  session: { id: string; name: string };
  days: Weekday[];
  slotsByShift: Array<{
    shiftId: string;
    shiftName: string;
    slots: RoutineSlotRow[];
  }>;
  sections: Array<{
    sectionId: string;
    sectionLabel: string;
    shiftId: string | null;
    shiftName: string | null;
    timetableId: string | null;
    status: TimetableStatus | null;
    filled: number;
    capacity: number;
    cells: RoutineCell[];
  }>;
  teacherLoad: Array<{
    teacherId: string;
    name: string;
    employeeId: string;
    periodsPerWeek: number;
    byDay: Record<string, number>;
  }>;
}

export interface CurrentPeriod {
  date: string;
  day: Weekday;
  at: string;
  holiday: boolean;
  holidayTitle?: string;
  slot: RoutineSlotRow | null;
  cell: RoutineCell | null;
}

export interface EntryInput {
  day: Weekday;
  periodSlotId: string;
  subjectId: string;
  teacherId: string;
  roomNo?: string;
  combinedWithSectionId?: string;
}

export interface ReplaceEntriesResult {
  saved: number;
  conflicts: RoutineConflict[];
  unassignedOverrides: Array<{
    day: Weekday;
    periodSlotId: string;
    teacherId: string;
    subjectId: string;
  }>;
}

/**
 * The conflict list a rejected save/publish carries. The backend refuses
 * the whole payload with a 409 and puts the offending cells in the
 * envelope's `error.details.conflicts`, which is what lets the builder
 * paint them red instead of only showing a toast.
 */
export function conflictsFromError(err: unknown): RoutineConflict[] {
  const details = (
    err as {
      response?: {
        data?: { error?: { details?: { conflicts?: RoutineConflict[] } } };
      };
    }
  )?.response?.data?.error?.details?.conflicts;
  return Array.isArray(details) ? details : [];
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams a PDF endpoint straight to a browser download. */
async function download(path: string, query: object = {}): Promise<void> {
  const res = await api.get<Blob>(path, {
    params: params(query),
    responseType: "blob",
  });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? "routine.pdf";
  link.click();
  URL.revokeObjectURL(url);
}

export const periodSlotApi = {
  async list(shiftId?: string): Promise<PeriodSlot[]> {
    const res = await api.get<ApiEnvelope<PeriodSlot[]>>("/period-slots", {
      params: params({ shiftId }),
    });
    return res.data.data;
  },

  async create(input: {
    shiftId: string;
    name: string;
    startTime: string;
    endTime: string;
    type?: PeriodSlotType;
    displayOrder?: number;
  }): Promise<PeriodSlot> {
    const res = await api.post<ApiEnvelope<PeriodSlot>>("/period-slots", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: Partial<{
      name: string;
      startTime: string;
      endTime: string;
      type: PeriodSlotType;
      displayOrder: number;
    }>,
  ): Promise<PeriodSlot> {
    const res = await api.put<ApiEnvelope<PeriodSlot>>(
      `/period-slots/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/period-slots/${id}`);
  },
};

export const timetableApi = {
  async list(query: {
    sessionId?: string;
    classId?: string;
    sectionId?: string;
    status?: TimetableStatus;
  }): Promise<TimetableSummary[]> {
    const res = await api.get<ApiEnvelope<TimetableSummary[]>>("/timetables", {
      params: params(query),
    });
    return res.data.data;
  },

  async get(id: string): Promise<TimetableDetail> {
    const res = await api.get<ApiEnvelope<TimetableDetail>>(
      `/timetables/${id}`,
    );
    return res.data.data;
  },

  async createDraft(input: {
    sectionId: string;
    sessionId?: string;
    effectiveFrom?: string;
    notes?: string;
    copyFromPublished?: boolean;
  }): Promise<TimetableSummary> {
    const res = await api.post<ApiEnvelope<TimetableSummary>>(
      "/timetables",
      input,
    );
    return res.data.data;
  },

  async replaceEntries(
    id: string,
    input: { entries: EntryInput[]; override?: boolean },
  ): Promise<ReplaceEntriesResult> {
    const res = await api.put<ApiEnvelope<ReplaceEntriesResult>>(
      `/timetables/${id}/entries`,
      input,
    );
    return res.data.data;
  },

  async publish(
    id: string,
    input: { effectiveFrom?: string; notes?: string } = {},
  ): Promise<TimetableSummary> {
    const res = await api.post<ApiEnvelope<TimetableSummary>>(
      `/timetables/${id}/publish`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/timetables/${id}`);
  },

  async conflicts(query: {
    sessionId: string;
    teacherId: string;
    day: Weekday;
    periodSlotId: string;
    sectionId?: string;
    roomNo?: string;
  }): Promise<RoutineConflict[]> {
    const res = await api.get<ApiEnvelope<RoutineConflict[]>>(
      "/timetables/conflicts",
      { params: params(query) },
    );
    return res.data.data;
  },

  async master(query: {
    sessionId?: string;
    shiftId?: string;
    classId?: string;
  }): Promise<MasterRoutine> {
    const res = await api.get<ApiEnvelope<MasterRoutine>>(
      "/timetables/master",
      { params: params(query) },
    );
    return res.data.data;
  },

  downloadMaster(query: object = {}): Promise<void> {
    return download("/timetables/master/export", query);
  },

  downloadPdf(id: string): Promise<void> {
    return download(`/timetables/${id}/pdf`);
  },
};

export const routineApi = {
  async section(
    sectionId: string,
    query: { sessionId?: string; includeDraft?: boolean } = {},
  ): Promise<SectionRoutine> {
    const res = await api.get<ApiEnvelope<SectionRoutine>>(
      `/sections/${sectionId}/routine`,
      {
        params: params({
          sessionId: query.sessionId,
          includeDraft: query.includeDraft ? "true" : undefined,
        }),
      },
    );
    return res.data.data;
  },

  async teacher(
    teacherId: string,
    query: { sessionId?: string; includeDraft?: boolean } = {},
  ): Promise<TeacherRoutine> {
    const res = await api.get<ApiEnvelope<TeacherRoutine>>(
      `/teachers/${teacherId}/routine`,
      {
        params: params({
          sessionId: query.sessionId,
          includeDraft: query.includeDraft ? "true" : undefined,
        }),
      },
    );
    return res.data.data;
  },

  async currentPeriod(
    sectionId: string,
    query: { date?: string; at?: string } = {},
  ): Promise<CurrentPeriod> {
    const res = await api.get<ApiEnvelope<CurrentPeriod>>(
      `/sections/${sectionId}/current-period`,
      { params: params(query) },
    );
    return res.data.data;
  },

  downloadSection(sectionId: string, query: object = {}): Promise<void> {
    return download(`/sections/${sectionId}/routine/pdf`, query);
  },

  downloadTeacher(teacherId: string, query: object = {}): Promise<void> {
    return download(`/teachers/${teacherId}/routine/pdf`, query);
  },
};
