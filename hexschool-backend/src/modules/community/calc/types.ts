/**
 * Plain string-literal unions mirroring the PG enums this module's engines
 * reason about.
 *
 * **No `calc/` engine imports `@prisma/client`** — the rule M24 broke and
 * paid for (reaching for the generated enums pulled the whole client into
 * every engine and every spec until Jest's workers ran out of memory), and
 * that M26 and M27 then applied from the start. `tsc` checks these lists
 * agree with the generated enums at every call site, so a divergence is a
 * compile error rather than a runtime surprise.
 */

export type TicketTypeCode = 'COMPLAINT' | 'SUGGESTION' | 'FEEDBACK';

export type TicketCategoryCode =
  | 'ACADEMIC'
  | 'FEES'
  | 'TRANSPORT'
  | 'HOSTEL'
  | 'TEACHER'
  | 'FACILITY'
  | 'OTHER';

export type TicketRaiserTypeCode =
  'GUARDIAN' | 'STUDENT' | 'STAFF' | 'ANONYMOUS' | 'PUBLIC';

export type TicketPriorityCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type TicketStatusCode =
  'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REOPENED';

export type VisitorPurposeCode =
  | 'MEETING'
  | 'ADMISSION_QUERY'
  | 'GUARDIAN_VISIT'
  | 'VENDOR'
  | 'OFFICIAL'
  | 'OTHER';

export type VisitorHostTypeCode = 'TEACHER' | 'STAFF';

export type AppointmentStatusCode =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW';

export type AlumniStatusCode = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AlumniRegistrationStatusCode =
  'REGISTERED' | 'ATTENDED' | 'CANCELLED';

export type DonationMethodCode =
  'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'MOBILE_BANKING' | 'IN_KIND' | 'OTHER';

export const TICKET_TYPES: readonly TicketTypeCode[] = [
  'COMPLAINT',
  'SUGGESTION',
  'FEEDBACK',
];

export const TICKET_CATEGORIES: readonly TicketCategoryCode[] = [
  'ACADEMIC',
  'FEES',
  'TRANSPORT',
  'HOSTEL',
  'TEACHER',
  'FACILITY',
  'OTHER',
];

export const TICKET_PRIORITIES: readonly TicketPriorityCode[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
];

export const TICKET_STATUSES: readonly TicketStatusCode[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

export const VISITOR_PURPOSES: readonly VisitorPurposeCode[] = [
  'MEETING',
  'ADMISSION_QUERY',
  'GUARDIAN_VISIT',
  'VENDOR',
  'OFFICIAL',
  'OTHER',
];
