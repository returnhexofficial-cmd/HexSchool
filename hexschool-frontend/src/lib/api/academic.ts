import { api, ApiEnvelope, PaginationMeta } from "./axios";

/** Mirrors the backend academic session/calendar API shapes (Module 05). */

export type SessionStatus = "UPCOMING" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type HolidayType = "GOVERNMENT" | "RELIGIOUS" | "SCHOOL" | "WEEKLY";
export type HolidayAppliesTo = "ALL" | "STUDENTS" | "STAFF";
export type CalendarEventType =
  | "EXAM"
  | "EVENT"
  | "MEETING"
  | "SPORTS"
  | "CULTURAL"
  | "OTHER";

export interface AcademicSession {
  id: string;
  name: string;
  /** ISO datetime; date part is authoritative (DATE column). */
  startDate: string;
  endDate: string;
  status: SessionStatus;
  isCurrent: boolean;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  sessionId: string;
  title: string;
  startDate: string;
  endDate: string;
  type: HolidayType;
  appliesTo: HolidayAppliesTo;
}

export interface CalendarEvent {
  id: string;
  sessionId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  type: CalendarEventType;
  isPublic: boolean;
}

export interface CalendarMonth {
  from: string;
  to: string;
  weeklyHolidays: string[];
  holidays: Holiday[];
  events: CalendarEvent[];
}

export interface HolidayImportReport {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  sessionId?: string;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

export const academicApi = {
  async listSessions(
    query: ListQuery = {},
  ): Promise<{ data: AcademicSession[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<AcademicSession[]>>(
      "/academic-sessions",
      { params: params(query) },
    );
    return { data: res.data.data, meta: res.data.meta! };
  },

  async currentSession(): Promise<AcademicSession | null> {
    const res = await api.get<ApiEnvelope<AcademicSession | null>>(
      "/academic-sessions/current",
    );
    return res.data.data;
  },

  async createSession(input: {
    name: string;
    startDate: string;
    endDate: string;
  }): Promise<AcademicSession> {
    const res = await api.post<ApiEnvelope<AcademicSession>>(
      "/academic-sessions",
      input,
    );
    return res.data.data;
  },

  async updateSession(
    id: string,
    input: {
      name?: string;
      startDate?: string;
      endDate?: string;
      status?: SessionStatus;
    },
  ): Promise<AcademicSession> {
    const res = await api.put<ApiEnvelope<AcademicSession>>(
      `/academic-sessions/${id}`,
      input,
    );
    return res.data.data;
  },

  async activateSession(id: string): Promise<AcademicSession> {
    const res = await api.post<ApiEnvelope<AcademicSession>>(
      `/academic-sessions/${id}/activate`,
    );
    return res.data.data;
  },

  async deleteSession(id: string): Promise<void> {
    await api.delete(`/academic-sessions/${id}`);
  },

  async calendarMonth(month: string): Promise<CalendarMonth> {
    const res = await api.get<ApiEnvelope<CalendarMonth>>("/calendar", {
      params: { month },
    });
    return res.data.data;
  },

  /** Raw .ics text — the caller turns it into a download blob. */
  async calendarIcs(month?: string): Promise<string> {
    const res = await api.get<string>("/calendar.ics", {
      params: params({ month }),
      responseType: "text",
    });
    return res.data;
  },

  async createHoliday(input: {
    sessionId: string;
    title: string;
    startDate: string;
    endDate: string;
    type?: HolidayType;
    appliesTo?: HolidayAppliesTo;
  }): Promise<Holiday> {
    const res = await api.post<ApiEnvelope<Holiday>>("/holidays", input);
    return res.data.data;
  },

  async deleteHoliday(id: string): Promise<void> {
    await api.delete(`/holidays/${id}`);
  },

  async importHolidays(
    sessionId: string,
    file: File,
  ): Promise<HolidayImportReport> {
    const form = new FormData();
    form.append("sessionId", sessionId);
    form.append("file", file);
    const res = await api.post<ApiEnvelope<HolidayImportReport>>(
      "/holidays/import",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data.data;
  },

  async createEvent(input: {
    sessionId: string;
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    type?: CalendarEventType;
    isPublic?: boolean;
  }): Promise<CalendarEvent> {
    const res = await api.post<ApiEnvelope<CalendarEvent>>(
      "/calendar-events",
      input,
    );
    return res.data.data;
  },

  async deleteEvent(id: string): Promise<void> {
    await api.delete(`/calendar-events/${id}`);
  },
};
