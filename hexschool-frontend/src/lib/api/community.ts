import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Complaint, Visitor & Alumni API (Module 28): the
 * complaints inbox and its thread, the gate desk and its appointments, the
 * alumni directory with its approval queue, and the donation register.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type TicketType = "COMPLAINT" | "SUGGESTION" | "FEEDBACK";

export type TicketCategory =
  | "ACADEMIC"
  | "FEES"
  | "TRANSPORT"
  | "HOSTEL"
  | "TEACHER"
  | "FACILITY"
  | "OTHER";

export type TicketRaiserType =
  | "GUARDIAN"
  | "STUDENT"
  | "STAFF"
  | "ANONYMOUS"
  | "PUBLIC";

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED";

export type VisitorPurpose =
  | "MEETING"
  | "ADMISSION_QUERY"
  | "GUARDIAN_VISIT"
  | "VENDOR"
  | "OFFICIAL"
  | "OTHER";

export type VisitorHostType = "TEACHER" | "STAFF";

export type AppointmentStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "NO_SHOW";

export type AlumniStatus = "PENDING" | "APPROVED" | "REJECTED";
export type AlumniRegistrationStatus = "REGISTERED" | "ATTENDED" | "CANCELLED";

export type DonationMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "MOBILE_BANKING"
  | "IN_KIND"
  | "OTHER";

export const TICKET_TYPES: TicketType[] = [
  "COMPLAINT",
  "SUGGESTION",
  "FEEDBACK",
];

export const TICKET_CATEGORIES: TicketCategory[] = [
  "ACADEMIC",
  "FEES",
  "TRANSPORT",
  "HOSTEL",
  "TEACHER",
  "FACILITY",
  "OTHER",
];

export const TICKET_PRIORITIES: TicketPriority[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
];

/** The kanban's columns, in the order the office works. */
export const TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];

export const VISITOR_PURPOSES: VisitorPurpose[] = [
  "MEETING",
  "ADMISSION_QUERY",
  "GUARDIAN_VISIT",
  "VENDOR",
  "OFFICIAL",
  "OTHER",
];

export const DONATION_METHODS: DonationMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "MOBILE_BANKING",
  "IN_KIND",
  "OTHER",
];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  COMPLAINT: "Complaint",
  SUGGESTION: "Suggestion",
  FEEDBACK: "Feedback",
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  ACADEMIC: "Academic",
  FEES: "Fees",
  TRANSPORT: "Transport",
  HOSTEL: "Hostel",
  TEACHER: "Teacher",
  FACILITY: "Facility",
  OTHER: "Other",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
};

export const TICKET_STATUS_VARIANT: Record<
  TicketStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  OPEN: "destructive",
  IN_PROGRESS: "default",
  RESOLVED: "secondary",
  CLOSED: "outline",
  REOPENED: "destructive",
};

export const TICKET_PRIORITY_VARIANT: Record<
  TicketPriority,
  "default" | "secondary" | "destructive" | "outline"
> = {
  LOW: "outline",
  MEDIUM: "secondary",
  HIGH: "default",
  URGENT: "destructive",
};

export const RAISER_LABELS: Record<TicketRaiserType, string> = {
  GUARDIAN: "Guardian",
  STUDENT: "Student",
  STAFF: "Staff",
  ANONYMOUS: "Anonymous",
  PUBLIC: "Website",
};

export const VISITOR_PURPOSE_LABELS: Record<VisitorPurpose, string> = {
  MEETING: "Meeting",
  ADMISSION_QUERY: "Admission query",
  GUARDIAN_VISIT: "Guardian visit",
  VENDOR: "Vendor",
  OFFICIAL: "Official",
  OTHER: "Other",
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Refused",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

export const ALUMNI_STATUS_LABELS: Record<AlumniStatus, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const DONATION_METHOD_LABELS: Record<DonationMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  MOBILE_BANKING: "Mobile banking",
  IN_KIND: "In kind",
  OTHER: "Other",
};

// ── shapes ─────────────────────────────────────────────────────────────

export interface TicketAttachment {
  url: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface Ticket {
  id: string;
  ticketNo: string;
  type: TicketType;
  category: TicketCategory;
  subject: string;
  description: string;
  attachments: TicketAttachment[];
  raisedByType: TicketRaiserType;
  raisedById: string | null;
  contact: { name?: string; phone?: string; email?: string } | null;
  assignedTo: string | null;
  assigneeName: string | null;
  /** `null` for an anonymous complaint — there is nothing on the row. */
  requesterName: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  isSensitive: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenClosesAt: string | null;
  satisfactionRating: number | null;
  firstResponseAt: string | null;
  escalatedAt: string | null;
  commentCount: number;
  createdAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface TicketSummary {
  from: string;
  to: string;
  total: number;
  byStatus: Array<{ status: TicketStatus; count: number }>;
  byCategory: Array<{ category: TicketCategory; count: number }>;
  byPriority: Array<{ priority: TicketPriority; count: number }>;
  resolution: {
    resolved: number;
    avgResolutionHours: number;
    avgFirstResponseHours: number;
    withinSla: number;
    slaCompliancePercent: number;
  };
  breachedNow: number;
  satisfaction: { rated: number; average: number };
  /** The report says what it could not see — the M27 lesson. */
  excludesSensitive: boolean;
}

export interface Visitor {
  id: string;
  name: string;
  phone: string;
  nid: string | null;
  address: string | null;
  purpose: VisitorPurpose;
  hostType: VisitorHostType | null;
  hostId: string | null;
  hostName: string | null;
  whomToMeet: string | null;
  cardNo: string | null;
  photoUrl: string | null;
  gatePassNo: string | null;
  checkIn: string;
  checkOut: string | null;
  validUntil: string | null;
  autoCheckedOut: boolean;
  appointmentId: string | null;
  remarks: string | null;
  inside: boolean;
  durationMinutes: number;
}

export interface VisitorHost {
  hostType: VisitorHostType;
  hostId: string;
  name: string;
  designation: string | null;
  department: string | null;
}

export interface Appointment {
  id: string;
  visitorName: string;
  phone: string;
  email: string | null;
  purpose: VisitorPurpose;
  hostType: VisitorHostType;
  hostId: string;
  hostName?: string | null;
  scheduledAt: string;
  status: AppointmentStatus;
  notes: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
}

export interface Alumni {
  id: string;
  studentId: string | null;
  name: string;
  batchYear: number;
  lastClass: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  profession: string | null;
  organization: string | null;
  photoUrl: string | null;
  bio: string | null;
  isPublicProfile: boolean;
  status: AlumniStatus;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  /** Roadmap §8: this claim collides with one already approved. */
  claimConflict?: boolean;
}

export interface MatchHint {
  studentId: string;
  studentUid: string;
  name: string;
  graduationYear: number | null;
  lastClass: string | null;
  phone: string | null;
  score: number;
  reasons: string[];
  alreadyClaimed: boolean;
}

export interface AlumniEvent {
  id: string;
  title: string;
  eventDate: string;
  venue: string | null;
  description: string | null;
  fee: string | null;
  capacity: number | null;
  registrationDeadline: string | null;
  isPublished: boolean;
  seatsTaken: number;
  seatsLeft: number | null;
  registrations: number;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  alumniId: string;
  alumni?: Alumni;
  guests: number;
  amountPaid: string;
  status: AlumniRegistrationStatus;
  notes: string | null;
}

export interface Donation {
  id: string;
  alumniId: string | null;
  donorName: string;
  donorPhone: string | null;
  donorEmail: string | null;
  amount: string;
  purpose: string | null;
  method: DonationMethod;
  receivedAt: string;
  receiptNo: string;
  voucherId: string | null;
  remarks: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

export interface GroupedTotal {
  key: string;
  label: string;
  count: number;
  amount: number;
  percent: number;
}

export interface DonationSummary {
  from: string;
  to: string;
  totals: {
    count: number;
    received: number;
    total: number;
    cancelled: number;
    cancelledAmount: number;
    fromAlumni: number;
    fromAlumniAmount: number;
    largest: number;
    average: number;
  };
  byPurpose: GroupedTotal[];
  byMethod: GroupedTotal[];
  byMonth: GroupedTotal[];
  topDonors: Array<{
    name: string;
    alumniId: string | null;
    count: number;
    amount: number;
  }>;
}

export interface VisitorRegister {
  from: string;
  to: string;
  stats: {
    total: number;
    inside: number;
    departed: number;
    autoCheckedOut: number;
    avgStayMinutes: number;
    byPurpose: Array<{ purpose: VisitorPurpose; count: number }>;
  };
  rows: Array<{
    name: string;
    phone: string;
    purpose: VisitorPurpose;
    whomToMeet: string | null;
    gatePassNo: string | null;
    checkIn: string;
    checkOut: string | null;
    autoCheckedOut: boolean;
    minutes: number;
  }>;
}

/** The public directory's shape — deliberately carries no contact details. */
export interface PublicAlumniProfile {
  id: string;
  name: string;
  batchYear: number;
  lastClass: string | null;
  profession: string | null;
  organization: string | null;
  photoUrl: string | null;
  bio: string | null;
}

// ── clients ────────────────────────────────────────────────────────────

function unwrap<T>(res: { data: ApiEnvelope<T> }): T {
  return res.data.data;
}

async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function queryOf(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  return entries.length
    ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`
    : "";
}

export const ticketApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    type?: TicketType;
    category?: TicketCategory;
    status?: TicketStatus;
    priority?: TicketPriority;
    assignedTo?: string;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Ticket[]>>("/tickets", { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) => unwrap<Ticket>(await api.get(`/tickets/${id}`)),

  thread: async (id: string) =>
    unwrap<TicketComment[]>(await api.get(`/tickets/${id}/comments`)),

  create: async (input: {
    type: TicketType;
    category: TicketCategory;
    subject: string;
    description: string;
    raisedByType?: TicketRaiserType;
    raisedById?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    priority?: TicketPriority;
    assignedTo?: string;
    isSensitive?: boolean;
  }) => unwrap<Ticket>(await api.post("/tickets", input)),

  assign: async (
    id: string,
    input: {
      assignedTo?: string | null;
      priority?: TicketPriority;
      category?: TicketCategory;
      isSensitive?: boolean;
    },
  ) => unwrap<Ticket>(await api.put(`/tickets/${id}/assign`, input)),

  setStatus: async (
    id: string,
    input: { status: TicketStatus; resolution?: string; notify?: boolean },
  ) => unwrap<Ticket>(await api.put(`/tickets/${id}/status`, input)),

  comment: async (
    id: string,
    input: { body: string; isInternal?: boolean; notify?: boolean },
  ) => unwrap<TicketComment>(await api.post(`/tickets/${id}/comments`, input)),

  remove: async (id: string) => {
    await api.delete(`/tickets/${id}`);
  },

  summary: async (params?: { from?: string; to?: string }) =>
    unwrap<TicketSummary>(
      await api.get("/tickets/reports/summary", { params }),
    ),

  downloadSummary: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/tickets/reports/summary/export${queryOf(params)}`,
      "ticket-summary.xlsx",
    ),

  downloadRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/tickets/reports/register/export${queryOf(params)}`,
      "tickets.xlsx",
    ),
};

export const visitorApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    purpose?: VisitorPurpose;
    inside?: boolean;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Visitor[]>>("/visitors", { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  inside: async () => unwrap<Visitor[]>(await api.get("/visitors/inside")),

  hosts: async () => unwrap<VisitorHost[]>(await api.get("/visitors/hosts")),

  get: async (id: string) => unwrap<Visitor>(await api.get(`/visitors/${id}`)),

  checkIn: async (input: {
    name: string;
    phone: string;
    nid?: string;
    address?: string;
    purpose: VisitorPurpose;
    hostType?: VisitorHostType;
    hostId?: string;
    whomToMeet?: string;
    cardNo?: string;
    photoUrl?: string;
    validUntil?: string;
    appointmentId?: string;
    remarks?: string;
  }) => unwrap<Visitor>(await api.post("/visitors", input)),

  checkOut: async (id: string, input?: { remarks?: string }) =>
    unwrap<Visitor>(await api.post(`/visitors/${id}/checkout`, input ?? {})),

  update: async (
    id: string,
    input: {
      whomToMeet?: string;
      cardNo?: string;
      photoUrl?: string;
      remarks?: string;
    },
  ) => unwrap<Visitor>(await api.patch(`/visitors/${id}`, input)),

  remove: async (id: string) => {
    await api.delete(`/visitors/${id}`);
  },

  printGatePass: (id: string, gatePassNo: string | null) =>
    downloadFile(
      `/visitors/${id}/gate-pass`,
      `gate-pass-${gatePassNo ?? id}.pdf`,
    ),

  register: async (params?: { from?: string; to?: string }) =>
    unwrap<VisitorRegister>(
      await api.get("/visitors/reports/register", { params }),
    ),

  downloadRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/visitors/reports/register/export${queryOf(params)}`,
      "visitors.xlsx",
    ),

  printRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/visitors/reports/register/pdf${queryOf(params)}`,
      "visitor-register.pdf",
    ),
};

export const appointmentApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: AppointmentStatus;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Appointment[]>>("/appointments", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  create: async (input: {
    visitorName: string;
    phone: string;
    email?: string;
    purpose: VisitorPurpose;
    hostType: VisitorHostType;
    hostId: string;
    scheduledAt: string;
    notes?: string;
  }) => unwrap<Appointment>(await api.post("/appointments", input)),

  decide: async (
    id: string,
    input: { status: AppointmentStatus; note?: string },
  ) => unwrap<Appointment>(await api.put(`/appointments/${id}/decision`, input)),

  remove: async (id: string) => {
    await api.delete(`/appointments/${id}`);
  },
};

export const alumniApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: AlumniStatus;
    batchYear?: number;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Alumni[]>>("/alumni", { params });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) => unwrap<Alumni>(await api.get(`/alumni/${id}`)),

  matchHints: async (id: string) =>
    unwrap<MatchHint[]>(await api.get(`/alumni/${id}/match-hints`)),

  create: async (input: Record<string, unknown>) =>
    unwrap<Alumni>(await api.post("/alumni", input)),

  update: async (id: string, input: Record<string, unknown>) =>
    unwrap<Alumni>(await api.put(`/alumni/${id}`, input)),

  decide: async (
    id: string,
    input: { status: AlumniStatus; reason?: string; studentId?: string },
  ) => unwrap<Alumni>(await api.put(`/alumni/${id}/decision`, input)),

  remove: async (id: string) => {
    await api.delete(`/alumni/${id}`);
  },

  downloadDirectory: () =>
    downloadFile("/alumni/reports/directory/export", "alumni-directory.xlsx"),
};

export const alumniEventApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    upcomingOnly?: boolean;
  }) => {
    const res = await api.get<ApiEnvelope<AlumniEvent[]>>("/alumni-events", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) =>
    unwrap<AlumniEvent>(await api.get(`/alumni-events/${id}`)),

  registrations: async (id: string) =>
    unwrap<EventRegistration[]>(
      await api.get(`/alumni-events/${id}/registrations`),
    ),

  create: async (input: Record<string, unknown>) =>
    unwrap<AlumniEvent>(await api.post("/alumni-events", input)),

  update: async (id: string, input: Record<string, unknown>) =>
    unwrap<AlumniEvent>(await api.put(`/alumni-events/${id}`, input)),

  register: async (
    id: string,
    input: { alumniId: string; guests?: number; amountPaid?: number; notes?: string },
  ) =>
    unwrap<{ registration: EventRegistration; warning: string | null }>(
      await api.post(`/alumni-events/${id}/registrations`, input),
    ),

  updateRegistration: async (
    registrationId: string,
    input: { status: AlumniRegistrationStatus; amountPaid?: number },
  ) =>
    unwrap<EventRegistration>(
      await api.put(`/alumni-events/registrations/${registrationId}`, input),
    ),

  remove: async (id: string) => {
    await api.delete(`/alumni-events/${id}`);
  },
};

export const donationApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    alumniId?: string;
    method?: DonationMethod;
    liveOnly?: boolean;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Donation[]>>("/donations", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) =>
    unwrap<Donation>(await api.get(`/donations/${id}`)),

  create: async (input: {
    alumniId?: string;
    donorName: string;
    donorPhone?: string;
    donorEmail?: string;
    amount: number;
    purpose?: string;
    method: DonationMethod;
    receivedAt?: string;
    remarks?: string;
    notify?: boolean;
  }) => unwrap<Donation>(await api.post("/donations", input)),

  /** There is no update — a receipt is immutable (roadmap §6). */
  cancel: async (id: string, input: { reason: string }) =>
    unwrap<Donation>(await api.post(`/donations/${id}/cancel`, input)),

  printReceipt: (id: string, receiptNo: string) =>
    downloadFile(`/donations/${id}/receipt`, `receipt-${receiptNo}.pdf`),

  summary: async (params?: { from?: string; to?: string }) =>
    unwrap<DonationSummary>(
      await api.get("/donations/reports/summary", { params }),
    ),

  downloadSummary: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/donations/reports/summary/export${queryOf(params)}`,
      "donation-summary.xlsx",
    ),

  downloadRegister: (params?: { from?: string; to?: string }) =>
    downloadFile(
      `/donations/reports/register/export${queryOf(params)}`,
      "donations.xlsx",
    ),
};

/** The unauthenticated surface — the website's forms and directory. */
export const publicCommunityApi = {
  submitTicket: async (input: {
    type: TicketType;
    category: TicketCategory;
    subject: string;
    description: string;
    name?: string;
    phone?: string;
    email?: string;
    anonymous?: boolean;
    recaptchaToken?: string;
  }) =>
    unwrap<{ message: string; ticketNo: string }>(
      await api.post("/public/tickets", input),
    ),

  registerAlumni: async (input: Record<string, unknown>) =>
    unwrap<{ message: string; status: AlumniStatus }>(
      await api.post("/public/alumni/register", input),
    ),

  directory: async (params?: {
    page?: number;
    limit?: number;
    batchYear?: number;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<PublicAlumniProfile[]>>(
      "/public/alumni",
      { params },
    );
    return { data: res.data.data, meta: res.data.meta };
  },

  batches: async () =>
    unwrap<Array<{ batchYear: number; count: number }>>(
      await api.get("/public/alumni/batches"),
    ),

  events: async () =>
    unwrap<
      Array<{
        id: string;
        title: string;
        eventDate: string;
        venue: string | null;
        description: string | null;
        fee: string | null;
        registrationDeadline: string | null;
      }>
    >(await api.get("/public/alumni/events")),
};

/** The family's own tickets, from the portal (M18's stub, now a thread). */
export const portalTicketApi = {
  mine: async () =>
    unwrap<Array<Ticket & { comments: TicketComment[] }>>(
      await api.get("/portal/tickets"),
    ),

  contact: async (input: {
    subject?: string;
    body: string;
    type?: TicketType;
    category?: TicketCategory;
  }) =>
    unwrap<{ message: string; ticketNo: string; id: string }>(
      await api.post("/portal/contact-school", input),
    ),

  reply: async (id: string, input: { body: string }) =>
    unwrap<TicketComment>(await api.post(`/portal/tickets/${id}/reply`, input)),

  rate: async (id: string, input: { rating: number; comment?: string }) =>
    unwrap<Ticket>(await api.post(`/portal/tickets/${id}/rating`, input)),
};
