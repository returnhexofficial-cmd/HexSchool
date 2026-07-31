import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Library Management API (Module 23): the catalogue
 * and its masters, copies and their barcode labels, library cards, the
 * circulation desk (issue / return / renew), fines, holds, the physical
 * stock-take, the reports — and the portal OPAC.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type BookCopyStatus =
  | "AVAILABLE"
  | "ISSUED"
  | "RESERVED"
  | "LOST"
  | "DAMAGED"
  | "WITHDRAWN";

export type BookCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";
export type LibraryMemberType = "STUDENT" | "TEACHER" | "STAFF";
export type LibraryMemberStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";
export type LibraryFineReason = "NONE" | "OVERDUE" | "LOST" | "DAMAGED";
export type ReservationStatus =
  | "ACTIVE"
  | "READY"
  | "FULFILLED"
  | "CANCELLED"
  | "EXPIRED";

export const COPY_STATUS_LABELS: Record<BookCopyStatus, string> = {
  AVAILABLE: "On the shelf",
  ISSUED: "On loan",
  RESERVED: "Held",
  LOST: "Lost",
  DAMAGED: "Damaged",
  WITHDRAWN: "Withdrawn",
};

export const COPY_STATUS_VARIANT: Record<
  BookCopyStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  AVAILABLE: "default",
  ISSUED: "secondary",
  RESERVED: "outline",
  LOST: "destructive",
  DAMAGED: "destructive",
  WITHDRAWN: "outline",
};

/** The three a librarian may write a copy off into. */
export const WRITE_OFF_STATUSES: BookCopyStatus[] = [
  "LOST",
  "DAMAGED",
  "WITHDRAWN",
];

export const CONDITIONS: BookCondition[] = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "DAMAGED",
];

export const MEMBER_TYPES: LibraryMemberType[] = [
  "STUDENT",
  "TEACHER",
  "STAFF",
];

export const MEMBER_TYPE_LABELS: Record<LibraryMemberType, string> = {
  STUDENT: "Student",
  TEACHER: "Teacher",
  STAFF: "Staff",
};

export const MEMBER_STATUS_LABELS: Record<LibraryMemberStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  ACTIVE: "Waiting",
  READY: "Ready to collect",
  FULFILLED: "Collected",
  CANCELLED: "Cancelled",
  EXPIRED: "Lapsed",
};

// ── shapes ──────────────────────────────────────────────────────────────

export interface LibraryRef {
  id: string;
  name: string;
  nameBn?: string | null;
}

export interface BookCategory extends LibraryRef {
  description: string | null;
}

export interface Author extends LibraryRef {
  note: string | null;
}

export interface Publisher extends LibraryRef {
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface Book {
  id: string;
  title: string;
  titleBn: string | null;
  isbn: string | null;
  categoryId: string;
  publisherId: string | null;
  edition: string | null;
  language: string;
  price: string | null;
  coverUrl: string | null;
  rackNo: string | null;
  description: string | null;
  category: LibraryRef;
  publisher: { id: string; name: string } | null;
  authors: Array<{ position: number; author: LibraryRef }>;
  copies: { total: number; available: number };
}

export interface BookCopy {
  id: string;
  bookId: string;
  accessionNo: string;
  status: BookCopyStatus;
  condition: BookCondition;
  conditionNote: string | null;
  purchasePrice: string | null;
  addedAt: string;
  book: {
    id: string;
    title: string;
    titleBn: string | null;
    isbn: string | null;
    price: string | null;
    rackNo: string | null;
    edition: string | null;
    category: { id: string; name: string };
  };
}

export interface DirectoryPerson {
  personType: LibraryMemberType;
  personId: string;
  name: string;
  reference: string;
  userId: string | null;
  phone: string | null;
  context: string | null;
  active: boolean;
}

export interface MemberStanding {
  openLoans: number;
  overdueLoans: number;
  outstandingFine: number;
}

export interface LibraryMember {
  id: string;
  personType: LibraryMemberType;
  personId: string;
  cardNo: string;
  maxBooks: number;
  status: LibraryMemberStatus;
  joinedAt: string;
  statusReason: string | null;
  person: DirectoryPerson | null;
  standing: MemberStanding;
}

export interface BookIssue {
  id: string;
  copyId: string;
  memberId: string;
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewCount: number;
  fineAmount: string;
  fineCollected: string;
  fineWaived: string;
  fineReason: LibraryFineReason;
  finePaid: boolean;
  fineWaiveReason: string | null;
  overdueDays: number;
  holidayDays: number;
  returnCondition: BookCondition | null;
  remarks: string | null;
  copy: {
    id: string;
    accessionNo: string;
    status: BookCopyStatus;
    book: {
      id: string;
      title: string;
      titleBn: string | null;
      price: string | null;
      rackNo: string | null;
    };
  };
  member: {
    id: string;
    cardNo: string;
    personType: LibraryMemberType;
    personId: string;
    status: LibraryMemberStatus;
    maxBooks: number;
  };
  /** Present on the outstanding-fines list. */
  outstanding?: number;
}

export type IssueBlockCode =
  | "LIBRARY_DISABLED"
  | "MEMBER_INACTIVE"
  | "MEMBER_LIMIT"
  | "MEMBER_FINE"
  | "MEMBER_OVERDUE"
  | "COPY_UNAVAILABLE"
  | "COPY_RESERVED_FOR_OTHER"
  | "DUPLICATE_TITLE";

/**
 * The engine's verdict, verbatim. The desk renders this rather than
 * re-deriving anything — that is the whole point of the backend having
 * one `canIssue` (see `circulation.engine.ts`).
 */
export interface IssueVerdict {
  allowed: boolean;
  code: IssueBlockCode | null;
  reason: string | null;
  overridable: boolean;
}

export interface IssuePreview {
  copy: BookCopy;
  member: LibraryMember | null;
  verdict: IssueVerdict;
}

export interface ReturnResult {
  issue: BookIssue;
  fine: {
    amount: number;
    daysLate: number;
    chargeableDays: number;
    holidayDays: number;
    capped: boolean;
    reason: LibraryFineReason;
    collected: number;
    outstanding: number;
  };
  heldFor: { reservationId: string; memberId: string } | null;
}

export interface Reservation {
  id: string;
  bookId: string;
  memberId: string;
  status: ReservationStatus;
  reservedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  book: { id: string; title: string; titleBn: string | null };
  member: {
    id: string;
    cardNo: string;
    personType: LibraryMemberType;
    personId: string;
  };
}

export interface OverdueRow {
  issueId: string;
  accessionNo: string;
  title: string;
  cardNo: string;
  memberName: string;
  memberContext: string | null;
  personType: LibraryMemberType;
  dueAt: string;
  daysOverdue: number;
  outstandingFine: number;
}

export interface StockReport {
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    titles: number;
    copies: number;
    available: number;
    issued: number;
    lost: number;
  }>;
  totals: Record<BookCopyStatus, number>;
  inStock: number;
  writtenOff: number;
}

export interface LibrarySummary {
  window: { from: string; to: string };
  issued: number;
  returned: number;
  onLoan: number;
  overdue: number;
  fines: {
    assessed: number;
    collected: number;
    waived: number;
    outstanding: number;
  };
  copies: Record<BookCopyStatus, number>;
}

export interface StockVerification {
  id: string;
  name: string;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  rackNo: string | null;
  startedAt: string;
  completedAt: string | null;
  expectedCount: number;
  scannedCount: number;
  missingCount: number;
  unexpectedCount: number;
  notes: string | null;
}

export interface StockDiff {
  expectedCount: number;
  scannedCount: number;
  verifiedCount: number;
  missing: Array<{
    id: string;
    accessionNo: string;
    bookTitle: string;
    rackNo: string | null;
  }>;
  unexpected: Array<{
    accessionNo: string;
    reason: "ON_LOAN" | "OUT_OF_CIRCULATION" | "UNKNOWN";
    copy: { accessionNo: string; bookTitle: string } | null;
  }>;
  misplaced: Array<{ id: string; accessionNo: string; bookTitle: string }>;
}

// ── OPAC (portal) ───────────────────────────────────────────────────────

export interface OpacBook {
  id: string;
  title: string;
  titleBn: string | null;
  isbn: string | null;
  edition: string | null;
  language: string;
  coverUrl: string | null;
  category: LibraryRef;
  publisher: { id: string; name: string } | null;
  authors: LibraryRef[];
  copies: { total: number; available: number };
  rackNo: string | null;
}

export interface MyLibrary {
  member: {
    id: string;
    cardNo: string;
    status: LibraryMemberStatus;
    maxBooks: number;
  } | null;
  loans: Array<{
    issueId: string;
    title: string;
    accessionNo: string;
    issuedAt: string;
    dueAt: string;
    renewCount: number;
    overdue: boolean;
    outstandingFine: number;
    canRenew: boolean;
    renewBlockedReason: string | null;
  }>;
  history?: Array<{
    issueId: string;
    title: string;
    issuedAt: string;
    returnedAt: string | null;
    fineAmount: number;
  }>;
  reservations: Array<{
    id: string;
    bookId: string;
    title: string;
    status: ReservationStatus;
    reservedAt: string;
    readyAt: string | null;
    expiresAt: string | null;
  }>;
  summary: {
    onLoan: number;
    overdue: number;
    outstandingFine: number;
    maxBooks?: number;
  };
  opacEnabled?: boolean;
  canReserve?: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────

const params = (query: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null,
    ),
  );

/** `2026-07-30T18:00:00Z` → `Thu 30 Jul 2026` in Asia/Dhaka. */
export function formatLibraryDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Whole days between now and a due date; negative when overdue. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((new Date(iso).getTime() - now) / 86_400_000);
}

export function formatBdt(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return `${value.toFixed(2)} BDT`;
}

/**
 * A barcode scanner is a keyboard: it types the code and presses Enter,
 * and depending on the model appends a carriage return or a tab. The
 * server strips these too (`normalizeScannedCode`), but doing it here as
 * well means the desk's own lookup never sees them.
 */
export function normalizeScan(raw: string): string {
  return raw.replace(/[\r\n\t]/g, "").trim().toUpperCase();
}

async function downloadFile(path: string, fallback: string): Promise<void> {
  const res = await api.get<Blob>(path, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadPost(
  path: string,
  body: unknown,
  fallback: string,
): Promise<void> {
  const res = await api.post<Blob>(path, body, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallback;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The transform interceptor lifts `meta` to the top level and leaves the
 * rows in `data` — one unwrap, not two (the M18 lesson).
 */
async function paginated<T>(
  path: string,
  query: object = {},
): Promise<{ rows: T[]; total: number }> {
  const res = await api.get<ApiEnvelope<T[]> & { meta?: { total: number } }>(
    path,
    { params: params(query) },
  );
  return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
}

async function unwrap<T>(path: string, query: object = {}): Promise<T> {
  const res = await api.get<ApiEnvelope<T>>(path, { params: params(query) });
  return res.data.data;
}

// ── masters ─────────────────────────────────────────────────────────────

export interface MasterInput {
  name: string;
  nameBn?: string;
  description?: string;
  note?: string;
  phone?: string;
  email?: string;
  address?: string;
}

function masterApi<T>(resource: string) {
  return {
    list: (query: { page?: number; limit?: number; search?: string } = {}) =>
      paginated<T>(`/library/${resource}`, query),
    async create(input: MasterInput): Promise<T> {
      const res = await api.post<ApiEnvelope<T>>(`/library/${resource}`, input);
      return res.data.data;
    },
    async update(id: string, input: MasterInput): Promise<T> {
      const res = await api.patch<ApiEnvelope<T>>(
        `/library/${resource}/${id}`,
        input,
      );
      return res.data.data;
    },
    async remove(id: string): Promise<void> {
      await api.delete(`/library/${resource}/${id}`);
    },
  };
}

export const categoryApi = masterApi<BookCategory>("categories");
export const authorApi = masterApi<Author>("authors");
export const publisherApi = masterApi<Publisher>("publishers");

// ── books & copies ──────────────────────────────────────────────────────

export interface BookInput {
  title: string;
  titleBn?: string;
  isbn?: string;
  categoryId: string;
  publisherId?: string;
  authorIds?: string[];
  authorNames?: string[];
  edition?: string;
  language?: string;
  price?: number | null;
  coverUrl?: string;
  rackNo?: string;
  description?: string;
}

export const bookApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: string;
      publisherId?: string;
      authorId?: string;
      rackNo?: string;
      availableOnly?: boolean;
    } = {},
  ) => paginated<Book>("/library/books", query),

  detail: (id: string) => unwrap<Book>(`/library/books/${id}`),

  async create(input: BookInput): Promise<Book> {
    const res = await api.post<ApiEnvelope<Book>>("/library/books", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<BookInput>): Promise<Book> {
    const res = await api.patch<ApiEnvelope<Book>>(
      `/library/books/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/library/books/${id}`);
  },

  async generateCopies(
    id: string,
    input: { count: number; condition?: BookCondition; purchasePrice?: number },
  ): Promise<BookCopy[]> {
    const res = await api.post<ApiEnvelope<BookCopy[]>>(
      `/library/books/${id}/copies`,
      input,
    );
    return res.data.data;
  },
};

export const copyApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      bookId?: string;
      status?: BookCopyStatus;
      search?: string;
    } = {},
  ) => paginated<BookCopy>("/library/copies", query),

  detail: (id: string) => unwrap<BookCopy>(`/library/copies/${id}`),

  statusTotals: () =>
    unwrap<Record<BookCopyStatus, number>>("/library/copies/status-totals"),

  byAccession: (accessionNo: string) =>
    unwrap<{ copy: BookCopy; openIssue: BookIssue | null }>(
      `/library/copies/by-accession/${encodeURIComponent(normalizeScan(accessionNo))}`,
    ),

  async update(
    id: string,
    input: {
      condition?: BookCondition;
      conditionNote?: string;
      purchasePrice?: number;
    },
  ): Promise<BookCopy> {
    const res = await api.patch<ApiEnvelope<BookCopy>>(
      `/library/copies/${id}`,
      input,
    );
    return res.data.data;
  },

  async mark(
    id: string,
    input: { status: BookCopyStatus; reason: string; fineAmount?: number },
  ): Promise<{
    copy: BookCopy;
    chargedMemberId: string | null;
    charge: number;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        copy: BookCopy;
        chargedMemberId: string | null;
        charge: number;
      }>
    >(`/library/copies/${id}/mark`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/library/copies/${id}`);
  },

  labels: (copyIds: string[]) =>
    downloadPost("/library/copies/labels", { copyIds }, "library-labels.pdf"),
};

// ── members ─────────────────────────────────────────────────────────────

export const memberApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      personType?: LibraryMemberType;
      status?: LibraryMemberStatus;
    } = {},
  ) => paginated<LibraryMember>("/library/members", query),

  detail: (id: string) => unwrap<LibraryMember>(`/library/members/${id}`),

  byCard: (cardNo: string) =>
    unwrap<LibraryMember>(
      `/library/members/by-card/${encodeURIComponent(normalizeScan(cardNo))}`,
    ),

  history: (id: string, query: { page?: number; limit?: number } = {}) =>
    paginated<BookIssue>(`/library/members/${id}/history`, query),

  searchPeople: (q: string) =>
    unwrap<Array<DirectoryPerson & { member: LibraryMember | null }>>(
      "/library/members/search-people",
      { q },
    ),

  async enrol(input: {
    personType: LibraryMemberType;
    personId: string;
    maxBooks?: number;
  }): Promise<LibraryMember> {
    const res = await api.post<ApiEnvelope<LibraryMember>>(
      "/library/members",
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: {
      maxBooks?: number;
      status?: LibraryMemberStatus;
      statusReason?: string;
    },
  ): Promise<LibraryMember> {
    const res = await api.patch<ApiEnvelope<LibraryMember>>(
      `/library/members/${id}`,
      input,
    );
    return res.data.data;
  },
};

// ── the desk ────────────────────────────────────────────────────────────

export interface IssueInput {
  accessionNo?: string;
  copyId?: string;
  cardNo?: string;
  memberId?: string;
  personType?: LibraryMemberType;
  personId?: string;
  loanDays?: number;
  override?: boolean;
  remarks?: string;
}

export interface ReturnInput {
  accessionNo?: string;
  copyId?: string;
  issueId?: string;
  condition?: BookCondition;
  conditionNote?: string;
  fineOverride?: number;
  fineReason?: string;
  collectFine?: boolean;
}

export const circulationApi = {
  async previewIssue(input: IssueInput): Promise<IssuePreview> {
    const res = await api.post<ApiEnvelope<IssuePreview>>(
      "/library/issue/preview",
      input,
    );
    return res.data.data;
  },

  async issue(input: IssueInput): Promise<BookIssue> {
    const res = await api.post<ApiEnvelope<BookIssue>>("/library/issue", input);
    return res.data.data;
  },

  async returnBook(input: ReturnInput): Promise<ReturnResult> {
    const res = await api.post<ApiEnvelope<ReturnResult>>(
      "/library/return",
      input,
    );
    return res.data.data;
  },

  async renew(
    id: string,
    input: { loanDays?: number; override?: boolean } = {},
  ): Promise<BookIssue> {
    const res = await api.post<ApiEnvelope<BookIssue>>(
      `/library/issues/${id}/renew`,
      input,
    );
    return res.data.data;
  },

  issues: (
    query: {
      page?: number;
      limit?: number;
      memberId?: string;
      bookId?: string;
      openOnly?: boolean;
      overdueOnly?: boolean;
      unpaidFineOnly?: boolean;
    } = {},
  ) => paginated<BookIssue>("/library/issues", query),

  detail: (id: string) => unwrap<BookIssue>(`/library/issues/${id}`),
};

export const fineApi = {
  outstanding: (query: { page?: number; limit?: number } = {}) =>
    paginated<BookIssue>("/library/fines/outstanding", query),

  async collect(
    issueId: string,
    input: { amount?: number; remarks?: string } = {},
  ): Promise<{ collected: number; outstanding: number; voucherId: string | null }> {
    const res = await api.post<
      ApiEnvelope<{
        collected: number;
        outstanding: number;
        voucherId: string | null;
      }>
    >(`/library/fines/${issueId}/collect`, input);
    return res.data.data;
  },

  async waive(
    issueId: string,
    input: { amount?: number; reason: string },
  ): Promise<{ waived: number; outstanding: number }> {
    const res = await api.post<
      ApiEnvelope<{ waived: number; outstanding: number }>
    >(`/library/fines/${issueId}/waive`, input);
    return res.data.data;
  },
};

export const reservationApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      bookId?: string;
      memberId?: string;
      liveOnly?: boolean;
    } = {},
  ) => paginated<Reservation>("/library/reservations", query),

  async create(input: { bookId: string; memberId: string }): Promise<{
    reservation: Reservation;
    position: number;
    queueLength: number;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        reservation: Reservation;
        position: number;
        queueLength: number;
      }>
    >("/library/reservations", input);
    return res.data.data;
  },

  async cancel(id: string): Promise<void> {
    await api.delete(`/library/reservations/${id}`);
  },
};

// ── reports & stock ─────────────────────────────────────────────────────

export const libraryReportApi = {
  summary: (query: { from?: string; to?: string } = {}) =>
    unwrap<LibrarySummary>("/library/reports/summary", query),

  overdue: () => unwrap<OverdueRow[]>("/library/reports/overdue"),

  issued: () =>
    unwrap<
      Array<{
        issueId: string;
        accessionNo: string;
        title: string;
        cardNo: string;
        memberName: string;
        issuedAt: string;
        dueAt: string;
        renewCount: number;
        overdue: boolean;
      }>
    >("/library/reports/issued"),

  popular: (query: { from?: string; to?: string; limit?: number } = {}) =>
    unwrap<
      Array<{
        bookId: string;
        title: string;
        category: string;
        authors: string[];
        issues: number;
      }>
    >("/library/reports/popular", query),

  stock: () => unwrap<StockReport>("/library/reports/stock"),

  clearance: (personType: LibraryMemberType, personId: string) =>
    unwrap<{
      cleared: boolean;
      booksOut: number;
      outstandingFine: number;
      details: string[];
    }>(`/library/clearance/${personType}/${personId}`),

  downloadOverdue: () =>
    downloadFile("/library/reports/overdue.xlsx", "library-overdue.xlsx"),
  downloadStock: () =>
    downloadFile("/library/reports/stock.xlsx", "library-stock.xlsx"),
  downloadPopular: () =>
    downloadFile("/library/reports/popular.xlsx", "library-popular.xlsx"),
  downloadMember: (id: string) =>
    downloadFile(
      `/library/reports/member/${id}.xlsx`,
      `library-member-${id}.xlsx`,
    ),
};

export const stockCheckApi = {
  list: (query: { page?: number; limit?: number } = {}) =>
    unwrap<{
      rows: StockVerification[];
      total: number;
    }>("/library/stock-checks", query),

  async start(input: { name: string; rackNo?: string }): Promise<StockVerification> {
    const res = await api.post<ApiEnvelope<StockVerification>>(
      "/library/stock-checks",
      input,
    );
    return res.data.data;
  },

  async scan(
    id: string,
    accessionNos: string[],
  ): Promise<{ accepted: number; matched: number; unknown: number; scanned: number }> {
    const res = await api.post<
      ApiEnvelope<{
        accepted: number;
        matched: number;
        unknown: number;
        scanned: number;
      }>
    >(`/library/stock-checks/${id}/scan`, {
      accessionNos: accessionNos.map(normalizeScan),
    });
    return res.data.data;
  },

  diff: (id: string) => unwrap<StockDiff>(`/library/stock-checks/${id}/diff`),

  async close(
    id: string,
    notes?: string,
  ): Promise<{ verification: StockVerification; diff: StockDiff }> {
    const res = await api.post<
      ApiEnvelope<{ verification: StockVerification; diff: StockDiff }>
    >(`/library/stock-checks/${id}/close`, { notes });
    return res.data.data;
  },

  async cancel(id: string): Promise<StockVerification> {
    const res = await api.post<ApiEnvelope<StockVerification>>(
      `/library/stock-checks/${id}/cancel`,
      {},
    );
    return res.data.data;
  },
};

// ── the portal OPAC ─────────────────────────────────────────────────────

export const opacApi = {
  search: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: string;
      availableOnly?: boolean;
    } = {},
  ) =>
    unwrap<{
      available: boolean;
      reason: string | null;
      rows: OpacBook[];
      total: number;
    }>("/portal/library/catalogue", query),

  me: () => unwrap<MyLibrary>("/portal/library/me"),

  async reserve(bookId: string): Promise<{ position: number; queueLength: number }> {
    const res = await api.post<
      ApiEnvelope<{ position: number; queueLength: number }>
    >("/portal/library/reservations", { bookId });
    return res.data.data;
  },

  async cancelReservation(id: string): Promise<void> {
    await api.delete(`/portal/library/reservations/${id}`);
  },

  childLibrary: (childId: string) =>
    unwrap<MyLibrary>(`/portal/parent/child/${childId}/library`),
};
