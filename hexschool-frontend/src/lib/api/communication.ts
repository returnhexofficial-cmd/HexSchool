import { api, ApiEnvelope, PaginationMeta } from "./axios";

/**
 * Mirrors the backend Communication API (Module 17): notification
 * templates, the single send entry point, the bulk composer, the in-app
 * inbox, notices and SMS-credit accounting.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type NotificationChannel = "SMS" | "EMAIL" | "IN_APP";
export type NotificationLanguage = "EN" | "BN";
export type NotificationRecipientType =
  | "USER"
  | "GUARDIAN"
  | "STUDENT"
  | "STAFF"
  | "RAW";
export type NotificationStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";
export type NoticeAudience =
  | "ALL"
  | "STUDENTS"
  | "PARENTS"
  | "TEACHERS"
  | "STAFF"
  | "CLASS"
  | "SECTION";
export type BulkAudience = NoticeAudience | "RAW";

// ── types ───────────────────────────────────────────────────────────────

export interface NotificationCode {
  code: string;
  module: string;
  description: string;
  channels: NotificationChannel[];
  variables: string[];
  defaultBody: string;
  defaultSubject?: string;
}

export interface NotificationTemplate {
  id: string;
  code: string;
  channel: NotificationChannel;
  language: NotificationLanguage;
  subject: string | null;
  body: string;
  isActive: boolean;
}

export interface TemplatePreview {
  body: string;
  subject: string | null;
  unknownVariables: string[];
  allowedVariables: string[];
  segments: number;
  unicode: boolean;
  charCount: number;
}

export interface NotificationRow {
  id: string;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  recipientId: string | null;
  destination: string | null;
  templateCode: string | null;
  subject: string | null;
  bodyRendered: string;
  status: NotificationStatus;
  isEmergency: boolean;
  providerMsgId: string | null;
  error: string | null;
  segments: number | null;
  cost: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxResult {
  items: NotificationRow[];
  unread: number;
}

export interface BulkPreview {
  recipients: number;
  segmentsPerMessage: number;
  unicode: boolean;
  totalParts: number;
  estimatedCost: number;
  requiresLargePermission: boolean;
  sample: string;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  audienceRef: Record<string, unknown> | null;
  attachmentUrls: string[] | null;
  isPublished: boolean;
  publishAt: string | null;
  isWebsiteVisible: boolean;
  pinned: boolean;
  createdAt: string;
}

export interface SmsCredit {
  id: string;
  type: "PURCHASE" | "CONSUME" | "ADJUST";
  qty: number;
  balanceAfter: number;
  ref: string | null;
  createdAt: string;
}

export interface CreateTemplateInput {
  code: string;
  channel: NotificationChannel;
  language?: NotificationLanguage;
  subject?: string;
  body: string;
  isActive?: boolean;
}

export interface SendDirectInput {
  code?: string;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  recipientId?: string;
  destination?: string;
  subject?: string;
  message: string;
  emergency?: boolean;
}

export interface BulkSendInput {
  code?: string;
  channel: NotificationChannel;
  audience: BulkAudience;
  sessionId?: string;
  classIds?: string[];
  sectionIds?: string[];
  customNumbers?: string[];
  subject?: string;
  message: string;
  emergency?: boolean;
  batchKey?: string;
}

export interface CreateNoticeInput {
  title: string;
  body: string;
  audience: NoticeAudience;
  audienceRef?: Record<string, unknown>;
  attachmentUrls?: string[];
  isPublished?: boolean;
  publishAt?: string;
  isWebsiteVisible?: boolean;
  pinned?: boolean;
}

/**
 * Client-side SMS segment estimate, mirroring the backend
 * `sms-parts.util.ts`: GSM-7 is 160/153 per part, unicode (any non-ASCII,
 * i.e. Bangla) is 70/67. A convenience for the composer's live counter —
 * the authoritative cost comes from the bulk-preview endpoint.
 */
export function smsParts(text: string): { parts: number; unicode: boolean } {
  const unicode = [...text].some((c) => c.charCodeAt(0) > 127);
  if (text.length === 0) return { parts: 1, unicode: false };
  if (unicode) {
    return {
      parts: text.length <= 70 ? 1 : Math.ceil(text.length / 67),
      unicode: true,
    };
  }
  return { parts: text.length <= 160 ? 1 : Math.ceil(text.length / 153), unicode: false };
}

export const STATUS_TONE: Record<NotificationStatus, string> = {
  QUEUED: "text-amber-600",
  SENT: "text-blue-600",
  DELIVERED: "text-green-600",
  FAILED: "text-red-600",
  CANCELLED: "text-muted-foreground",
};

export const communicationApi = {
  // templates
  async codes() {
    const res = await api.get<ApiEnvelope<NotificationCode[]>>(
      "/notification-templates/codes",
    );
    return res.data.data;
  },
  async listTemplates() {
    const res = await api.get<ApiEnvelope<NotificationTemplate[]>>(
      "/notification-templates",
    );
    return res.data.data;
  },
  async createTemplate(input: CreateTemplateInput) {
    const res = await api.post<ApiEnvelope<NotificationTemplate>>(
      "/notification-templates",
      input,
    );
    return res.data.data;
  },
  async updateTemplate(
    id: string,
    input: Partial<Pick<CreateTemplateInput, "subject" | "body" | "isActive">>,
  ) {
    const res = await api.put<ApiEnvelope<NotificationTemplate>>(
      `/notification-templates/${id}`,
      input,
    );
    return res.data.data;
  },
  async deleteTemplate(id: string) {
    await api.delete(`/notification-templates/${id}`);
  },
  async previewTemplate(input: {
    code: string;
    body: string;
    subject?: string;
  }) {
    const res = await api.post<ApiEnvelope<TemplatePreview>>(
      "/notification-templates/preview",
      input,
    );
    return res.data.data;
  },

  // send + log
  async log(params: {
    channel?: NotificationChannel;
    status?: NotificationStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const res = await api.get<ApiEnvelope<NotificationRow[]>>("/notifications", {
      params,
    });
    return { rows: res.data.data, meta: res.data.meta as PaginationMeta };
  },
  async send(input: SendDirectInput) {
    const res = await api.post<ApiEnvelope<NotificationRow | null>>(
      "/notifications/send",
      input,
    );
    return res.data.data;
  },
  async retry(ids: string[]) {
    const res = await api.post<ApiEnvelope<{ requeued: number }>>(
      "/notifications/retry",
      { ids },
    );
    return res.data.data;
  },
  async bulkPreview(input: BulkSendInput) {
    const res = await api.post<ApiEnvelope<BulkPreview>>(
      "/notifications/bulk/preview",
      input,
    );
    return res.data.data;
  },
  async bulkSend(input: BulkSendInput) {
    const res = await api.post<ApiEnvelope<{ batchKey: string; queued: number }>>(
      "/notifications/bulk",
      input,
    );
    return res.data.data;
  },

  // inbox
  async inbox(unread = false) {
    const res = await api.get<ApiEnvelope<InboxResult>>("/notifications/me", {
      params: unread ? { unread: "true" } : {},
    });
    return res.data.data;
  },
  async markRead(ids?: string[]) {
    const res = await api.put<ApiEnvelope<{ updated: number }>>(
      "/notifications/me/read",
      { ids },
    );
    return res.data.data;
  },

  // notices
  async listNotices(params: { page?: number; limit?: number; search?: string }) {
    const res = await api.get<ApiEnvelope<Notice[]>>("/notices", { params });
    return { rows: res.data.data, meta: res.data.meta as PaginationMeta };
  },
  async createNotice(input: CreateNoticeInput) {
    const res = await api.post<ApiEnvelope<Notice>>("/notices", input);
    return res.data.data;
  },
  async updateNotice(id: string, input: Partial<CreateNoticeInput>) {
    const res = await api.put<ApiEnvelope<Notice>>(`/notices/${id}`, input);
    return res.data.data;
  },
  async publishNotice(id: string, publish: boolean) {
    const res = await api.put<ApiEnvelope<Notice>>(`/notices/${id}/publish`, {
      publish,
    });
    return res.data.data;
  },
  async deleteNotice(id: string) {
    await api.delete(`/notices/${id}`);
  },

  // credits
  async balance() {
    const res = await api.get<ApiEnvelope<{ balance: number; metered: boolean }>>(
      "/sms-credits/balance",
    );
    return res.data.data;
  },
  async ledger() {
    const res = await api.get<ApiEnvelope<SmsCredit[]>>("/sms-credits/ledger");
    return res.data.data;
  },
  async adjustCredit(input: { qty: number; purchase?: boolean; ref?: string }) {
    const res = await api.post<ApiEnvelope<{ balance: number }>>(
      "/sms-credits/adjust",
      input,
    );
    return res.data.data;
  },
};
