import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Reports & Analytics v2 API (Module 29): the report
 * catalog and its runs, the schedule manager, the export centre, and the
 * executive dashboard panels.
 *
 * `GET /reports` is M18's URL and this client replaces M18's
 * `portalApi.reports` — the payload is a superset (every field the old
 * hub read is still there), which is why the hub could be upgraded in
 * place rather than moved.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type ReportOutput = "TABLE" | "CHART" | "PDF" | "XLSX";
export type ReportFormat = "XLSX" | "CSV" | "PDF" | "JSON";
export type ReportRunStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
export type ReportScheduleStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export type ReportParamType =
  | "session"
  | "class"
  | "section"
  | "exam"
  | "student"
  | "route"
  | "item"
  | "account"
  | "vehicle"
  | "hostel"
  | "supplier"
  | "month"
  | "date"
  | "text"
  | "number"
  | "boolean"
  | "enum";

export const REPORT_FORMATS: ReportFormat[] = ["XLSX", "CSV", "PDF", "JSON"];

/** The id-shaped param types the hub renders a picker for. */
export const ID_PARAM_TYPES: ReportParamType[] = [
  "session",
  "class",
  "section",
  "exam",
  "student",
  "route",
  "item",
  "account",
  "vehicle",
  "hostel",
  "supplier",
];

// ── shapes ────────────────────────────────────────────────────────────

export interface ReportParam {
  key: string;
  label: string;
  type: ReportParamType;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  help?: string;
  default?: string | number | boolean;
}

export interface ReportDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
  permission: string;
  endpoint?: string;
  params: ReportParam[];
  output: ReportOutput;
  formats: ReportFormat[];
  runnable: boolean;
  sensitivePermission?: string;
  freshness?: string;
  /** True when the caller lacks the column-level data permission. */
  columnsWillBeWithheld: boolean;
}

export interface ReportRun {
  id: string;
  reportCode: string;
  reportName: string;
  scheduleId: string | null;
  params: Record<string, unknown>;
  format: ReportFormat;
  status: ReportRunStatus;
  requestedBy: string | null;
  fileSize: number | null;
  rowCount: number | null;
  durationMs: number | null;
  strippedColumns: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  downloadable: boolean;
}

export interface ReportSchedule {
  id: string;
  reportCode: string;
  reportName: string;
  name: string;
  params: Record<string, unknown>;
  cron: string;
  cronDescription: string;
  recipients: { emails?: string[]; userIds?: string[] };
  format: ReportFormat;
  status: ReportScheduleStatus;
  ownerId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: ReportRunStatus | null;
  lastError: string | null;
  failureCount: number;
  disabledReason: string | null;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "percent";
  width?: number;
  permission?: string;
}

export interface ReportPreview {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  notes?: string[];
  summary?: Array<{ label: string; value: string | number }>;
  totalRows: number;
  truncated: boolean;
  strippedColumns: string[];
}

export interface SeriesPoint {
  key: string;
  value: number;
}

export interface YoYPoint {
  key: string;
  current: number;
  previous: number;
  changePct: number | null;
}

export interface HeatmapCell {
  row: string;
  column: string;
  value: number | null;
}

export interface Heatmap {
  rows: string[];
  columns: string[];
  cells: HeatmapCell[];
  min: number | null;
  max: number | null;
}

export interface EnrollmentPanel {
  series: YoYPoint[];
  byClass: Array<{ className: string; count: number }>;
  total: number;
  trend: { direction: "up" | "down" | "flat"; changePct: number | null } | null;
  computedAt: string;
  cached?: boolean;
}

export interface AttendancePanel {
  heatmap: Heatmap;
  freshness: string;
  computedAt: string;
  cached?: boolean;
}

export interface FinancePanel {
  monthly: Array<{
    month: string;
    billed: number;
    collected: number;
    rate: number | null;
  }>;
  twelveMonth: {
    billed: number;
    collected: number;
    outstanding: number;
    rate: number | null;
  };
  aging: Array<{
    label: string;
    from: number;
    to: number | null;
    count: number;
    amount: number;
  }>;
  collectionTrend: {
    direction: "up" | "down" | "flat";
    changePct: number | null;
  } | null;
  freshness: string;
  computedAt: string;
  cached?: boolean;
}

export interface ResultsPanel {
  exams: Array<{
    examId: string;
    examName: string;
    examDate: string;
    candidates: number;
    passRate: number | null;
    avgGpa: number | null;
  }>;
  freshness: string;
  computedAt: string;
  cached?: boolean;
}

export interface OperationsPanel {
  snapshot: {
    booksOnLoan: number;
    booksOverdue: number;
    transportRiders: number;
    hostelResidents: number;
    openTickets: number;
    lowStockItems: number;
  };
  staff: {
    teachers: number;
    assignments: number;
    onLeaveToday: number;
  } | null;
  messaging: Array<{ label: string; value: number }>;
  smsSpend: number;
  computedAt: string;
  cached?: boolean;
}

export interface WebsitePanel {
  from: string;
  to: string;
  days: Array<{
    date: string;
    pageViews: number;
    uniqueVisitors: number;
    topPages: Array<{ path: string; views: number }>;
    topReferrers: Array<{ referrer: string; views: number }>;
  }>;
  totals: { pageViews: number; peakDay: string | null };
  today: { pageViews: number; uniqueVisitors: number } | null;
  topPages: Array<{ path: string; views: number }>;
}

export interface ExecutiveDashboard {
  session: { id: string; name: string } | null;
  enrollment: EnrollmentPanel;
  attendance: AttendancePanel;
  finance: FinancePanel;
  results: ResultsPanel;
  operations: OperationsPanel;
  website: WebsitePanel | null;
  computedAt: string;
}

export interface CronPreset {
  key: string;
  cron: string;
  description: string;
}

// ── client ────────────────────────────────────────────────────────────

export const analyticsApi = {
  // ── catalog ─────────────────────────────────────────────────────────

  async reports(): Promise<ReportDefinition[]> {
    const res = await api.get<ApiEnvelope<ReportDefinition[]>>("/reports");
    return res.data.data;
  },

  async report(code: string): Promise<ReportDefinition> {
    const res = await api.get<ApiEnvelope<ReportDefinition>>(
      `/reports/${code}`,
    );
    return res.data.data;
  },

  /** Queues a run; poll the export centre for the file. */
  async run(
    code: string,
    body: { format?: ReportFormat; params?: Record<string, unknown> },
  ): Promise<ReportRun> {
    const res = await api.post<ApiEnvelope<ReportRun>>(
      `/reports/${code}/run`,
      body,
    );
    return res.data.data;
  },

  /** The first hundred rows, for checking the parameters before running. */
  async preview(
    code: string,
    body: { params?: Record<string, unknown> },
  ): Promise<ReportPreview> {
    const res = await api.post<ApiEnvelope<ReportPreview>>(
      `/reports/${code}/preview`,
      body,
    );
    return res.data.data;
  },

  /**
   * Renders a small report inline and saves it. The queue exists so a
   * large export cannot block a request; making a two-hundred-row summary
   * take a queue, an upload and a poll is ceremony the user pays for.
   */
  async downloadNow(
    code: string,
    body: { format: ReportFormat; params?: Record<string, unknown> },
  ): Promise<void> {
    const res = await api.post<Blob>(`/reports/${code}/download`, body, {
      responseType: "blob",
    });
    const disposition = String(res.headers["content-disposition"] ?? "");
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const url = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = match?.[1] ?? `${code}.${body.format.toLowerCase()}`;
    link.click();
    URL.revokeObjectURL(url);
  },

  // ── export centre ───────────────────────────────────────────────────

  async runs(params: {
    page?: number;
    limit?: number;
    reportCode?: string;
    status?: ReportRunStatus;
    mine?: boolean;
  }) {
    const res = await api.get<ApiEnvelope<ReportRun[]>>("/report-runs", {
      params: { ...params, mine: params.mine ? "true" : undefined },
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  async runDetail(id: string): Promise<ReportRun> {
    const res = await api.get<ApiEnvelope<ReportRun>>(`/report-runs/${id}`);
    return res.data.data;
  },

  /**
   * A freshly signed URL, then a navigation. The URL on the row is minted
   * at generation time and is long expired by the time anybody looks at
   * the list, so the link has to be re-signed per click.
   */
  async download(id: string): Promise<void> {
    const res = await api.get<ApiEnvelope<{ url: string; filename: string }>>(
      `/report-runs/${id}/download`,
    );
    const link = document.createElement("a");
    link.href = res.data.data.url;
    link.download = res.data.data.filename;
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
  },

  async rerun(id: string): Promise<ReportRun> {
    const res = await api.post<ApiEnvelope<ReportRun>>(
      `/report-runs/${id}/rerun`,
    );
    return res.data.data;
  },

  // ── schedules ───────────────────────────────────────────────────────

  async schedules(params: {
    reportCode?: string;
    status?: ReportScheduleStatus;
    search?: string;
  }): Promise<ReportSchedule[]> {
    const res = await api.get<ApiEnvelope<ReportSchedule[]>>(
      "/report-schedules",
      { params },
    );
    return res.data.data;
  },

  async cronPresets(): Promise<CronPreset[]> {
    const res = await api.get<ApiEnvelope<CronPreset[]>>(
      "/report-schedules/presets",
    );
    return res.data.data;
  },

  async createSchedule(body: {
    reportCode: string;
    name: string;
    cron: string;
    format?: ReportFormat;
    params?: Record<string, unknown>;
    recipients: { emails?: string[]; userIds?: string[] };
  }): Promise<ReportSchedule> {
    const res = await api.post<ApiEnvelope<ReportSchedule>>(
      "/report-schedules",
      body,
    );
    return res.data.data;
  },

  async updateSchedule(
    id: string,
    body: {
      name?: string;
      cron?: string;
      format?: ReportFormat;
      params?: Record<string, unknown>;
      recipients?: { emails?: string[]; userIds?: string[] };
      status?: "ACTIVE" | "PAUSED";
    },
  ): Promise<ReportSchedule> {
    const res = await api.put<ApiEnvelope<ReportSchedule>>(
      `/report-schedules/${id}`,
      body,
    );
    return res.data.data;
  },

  async deleteSchedule(id: string): Promise<void> {
    await api.delete(`/report-schedules/${id}`);
  },

  async testRun(id: string): Promise<{ runId: string }> {
    const res = await api.post<ApiEnvelope<{ runId: string }>>(
      `/report-schedules/${id}/test-run`,
    );
    return res.data.data;
  },

  // ── analytics panels ────────────────────────────────────────────────

  async executive(params: {
    sessionId?: string;
    refresh?: boolean;
  }): Promise<ExecutiveDashboard> {
    const res = await api.get<ApiEnvelope<ExecutiveDashboard>>(
      "/analytics/executive",
      { params },
    );
    return res.data.data;
  },

  async enrollment(refresh = false): Promise<EnrollmentPanel> {
    const res = await api.get<ApiEnvelope<EnrollmentPanel>>(
      "/analytics/enrollment",
      { params: { refresh: refresh || undefined } },
    );
    return res.data.data;
  },

  async attendanceHeatmap(sessionId?: string): Promise<AttendancePanel> {
    const res = await api.get<ApiEnvelope<AttendancePanel>>(
      "/analytics/attendance-heatmap",
      { params: { sessionId } },
    );
    return res.data.data;
  },

  async finance(refresh = false): Promise<FinancePanel> {
    const res = await api.get<ApiEnvelope<FinancePanel>>("/analytics/finance", {
      params: { refresh: refresh || undefined },
    });
    return res.data.data;
  },

  async results(sessionId?: string): Promise<ResultsPanel> {
    const res = await api.get<ApiEnvelope<ResultsPanel>>("/analytics/results", {
      params: { sessionId },
    });
    return res.data.data;
  },

  async operations(refresh = false): Promise<OperationsPanel> {
    const res = await api.get<ApiEnvelope<OperationsPanel>>(
      "/analytics/operations",
      { params: { refresh: refresh || undefined } },
    );
    return res.data.data;
  },

  async website(params: {
    from?: string;
    to?: string;
    days?: number;
  }): Promise<WebsitePanel> {
    const res = await api.get<ApiEnvelope<WebsitePanel>>("/analytics/website", {
      params,
    });
    return res.data.data;
  },

  async refreshViews(views?: string[]) {
    const res = await api.post<
      ApiEnvelope<{
        views: Array<{
          view: string;
          ok: boolean;
          durationMs: number;
          error?: string;
        }>;
      }>
    >("/analytics/refresh-views", { views });
    return res.data.data.views;
  },
};

/**
 * The page-view beacon the public layout fires. Deliberately not part of
 * `analyticsApi`: it is unauthenticated, it must never surface an error to
 * the reader, and a marketing page must not fail because a counter did.
 */
export async function recordPageView(
  path: string,
  referrer?: string,
): Promise<void> {
  try {
    await api.post("/public/analytics/collect", { path, referrer });
  } catch {
    // A counter that can break the page it counts is worse than no counter.
  }
}
