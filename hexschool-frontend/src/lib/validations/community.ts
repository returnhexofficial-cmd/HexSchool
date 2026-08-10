import { z } from "zod";

/**
 * Mirrors the backend Complaint, Visitor & Alumni DTOs (Module 28).
 *
 * These schemas catch the obvious mistakes before a round trip; the
 * backend re-validates everything, and the database CHECKs the invariants
 * that matter (an anonymous ticket carrying no contact, a donation above
 * zero, a resolved ticket carrying its resolution).
 */

export const TICKET_TYPE_VALUES = [
  "COMPLAINT",
  "SUGGESTION",
  "FEEDBACK",
] as const;

export const TICKET_CATEGORY_VALUES = [
  "ACADEMIC",
  "FEES",
  "TRANSPORT",
  "HOSTEL",
  "TEACHER",
  "FACILITY",
  "OTHER",
] as const;

export const TICKET_PRIORITY_VALUES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;

export const TICKET_STATUS_VALUES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
] as const;

export const VISITOR_PURPOSE_VALUES = [
  "MEETING",
  "ADMISSION_QUERY",
  "GUARDIAN_VISIT",
  "VENDOR",
  "OFFICIAL",
  "OTHER",
] as const;

export const APPOINTMENT_STATUS_VALUES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "NO_SHOW",
] as const;

export const DONATION_METHOD_VALUES = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "MOBILE_BANKING",
  "IN_KIND",
  "OTHER",
] as const;

/** PROJECT_CONTEXT §12's BD mobile shape. */
const BD_PHONE = /^01[3-9]\d{8}$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const optionalPhone = z
  .string()
  .optional()
  .refine(
    (value) => !value || BD_PHONE.test(value),
    "Enter a valid Bangladeshi mobile number",
  );

const optionalEmail = z
  .string()
  .optional()
  .refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Enter a valid email address",
  );

const optionalDate = z
  .string()
  .optional()
  .refine(
    (value) => !value || DATE_SHAPE.test(value),
    "Use the date picker (YYYY-MM-DD)",
  );

// ── tickets ───────────────────────────────────────────────────────────

const ticketBody = {
  type: z.enum(TICKET_TYPE_VALUES),
  category: z.enum(TICKET_CATEGORY_VALUES),
  /** Roadmap §7: subject ≤ 200. */
  subject: z
    .string()
    .min(3, "Give the complaint a subject")
    .max(200, "Keep the subject under 200 characters"),
  description: z
    .string()
    .min(5, "Say what happened")
    .max(5000, "That is longer than the form accepts"),
};

export const ticketSchema = z.object({
  ...ticketBody,
  raisedByType: z.enum(["GUARDIAN", "STUDENT", "STAFF", "PUBLIC"]).optional(),
  raisedById: z.string().uuid().optional().or(z.literal("")),
  contactName: z.string().max(160).optional(),
  contactPhone: optionalPhone,
  contactEmail: optionalEmail,
  priority: z.enum(TICKET_PRIORITY_VALUES).optional(),
  assignedTo: z.string().uuid().optional().or(z.literal("")),
  isSensitive: z.boolean().optional(),
});

/**
 * The public complaint form. The refinement is the anonymous box's whole
 * contract stated on the client: **either** tell us who you are, **or**
 * tick anonymous and accept that there will be no reply. The backend
 * enforces the same rule and the DB CHECK makes it structural.
 */
export const publicTicketSchema = z
  .object({
    ...ticketBody,
    name: z.string().max(160).optional(),
    phone: optionalPhone,
    email: optionalEmail,
    anonymous: z.boolean().optional(),
  })
  .refine(
    (value) => value.anonymous === true || Boolean(value.phone || value.email),
    {
      message:
        "Leave a phone number or an email so the school can reply — or tick “submit anonymously”.",
      path: ["phone"],
    },
  );

export const ticketStatusSchema = z
  .object({
    status: z.enum(TICKET_STATUS_VALUES),
    resolution: z.string().max(4000).optional(),
    notify: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !["RESOLVED", "CLOSED"].includes(value.status) ||
      Boolean(value.resolution?.trim()),
    {
      // The DB CHECK refuses the row without it; saying so here saves a
      // round trip and explains WHY, which the 400 cannot.
      message:
        "Say what was done — a ticket marked resolved with nothing on it is the one a parent rings about.",
      path: ["resolution"],
    },
  );

export const ticketCommentSchema = z.object({
  body: z.string().min(1, "Write something").max(4000),
  isInternal: z.boolean().optional(),
  notify: z.boolean().optional(),
});

export const ticketRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export type TicketForm = z.infer<typeof ticketSchema>;
export type PublicTicketForm = z.infer<typeof publicTicketSchema>;
export type TicketStatusForm = z.infer<typeof ticketStatusSchema>;
export type TicketCommentForm = z.infer<typeof ticketCommentSchema>;

// ── visitors ──────────────────────────────────────────────────────────

export const checkInSchema = z
  .object({
    name: z.string().min(2, "Who is visiting?").max(160),
    phone: z.string().regex(BD_PHONE, "Enter a valid Bangladeshi mobile number"),
    nid: z.string().max(20).optional(),
    address: z.string().max(250).optional(),
    purpose: z.enum(VISITOR_PURPOSE_VALUES),
    hostType: z.enum(["TEACHER", "STAFF"]).optional(),
    hostId: z.string().uuid().optional().or(z.literal("")),
    whomToMeet: z.string().max(160).optional(),
    cardNo: z.string().max(30).optional(),
    photoUrl: z.string().max(500).optional(),
    validUntil: optionalDate,
    appointmentId: z.string().uuid().optional().or(z.literal("")),
    remarks: z.string().max(1000).optional(),
  })
  .refine(
    // Roadmap §8: only an OFFICIAL visit earns a multi-day pass. A
    // fortnight-long pass for a vendor is what a gate register exists to
    // prevent, so the form refuses before the API does.
    (value) => !value.validUntil || value.purpose === "OFFICIAL",
    {
      message:
        "Only an OFFICIAL visit may hold a multi-day pass — everybody else is recorded per visit.",
      path: ["validUntil"],
    },
  );

export const appointmentSchema = z.object({
  visitorName: z.string().min(2, "Who is coming?").max(160),
  phone: z.string().regex(BD_PHONE, "Enter a valid Bangladeshi mobile number"),
  email: optionalEmail,
  purpose: z.enum(VISITOR_PURPOSE_VALUES),
  hostType: z.enum(["TEACHER", "STAFF"]),
  hostId: z.string().uuid("Choose who they are coming to see"),
  scheduledAt: z.string().min(1, "When?"),
  notes: z.string().max(2000).optional(),
});

export const appointmentDecisionSchema = z
  .object({
    status: z.enum(APPOINTMENT_STATUS_VALUES),
    note: z.string().max(1000).optional(),
  })
  .refine(
    (value) => value.status !== "REJECTED" || Boolean(value.note?.trim()),
    {
      message: "Say why — the visitor will ring back and ask.",
      path: ["note"],
    },
  );

export type CheckInForm = z.infer<typeof checkInSchema>;
export type AppointmentForm = z.infer<typeof appointmentSchema>;

// ── alumni ────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

const alumniBody = {
  name: z.string().min(2, "Enter a name").max(160),
  batchYear: z
    .number()
    .int("The batch year must be a whole year")
    .min(1950, "The batch year must be 1950 or later")
    // Somebody finishing this coming December is a student, not an
    // alumnus. The DB CHECK carries a wide sanity range instead, because a
    // constraint over CURRENT_DATE is not IMMUTABLE.
    .max(CURRENT_YEAR, `The batch year cannot be in the future`),
  lastClass: z.string().max(80).optional(),
  phone: optionalPhone,
  email: optionalEmail,
  address: z.string().max(250).optional(),
  profession: z.string().max(160).optional(),
  organization: z.string().max(160).optional(),
  photoUrl: z.string().max(500).optional(),
  bio: z.string().max(2000).optional(),
  isPublicProfile: z.boolean().optional(),
};

const needsAContact = {
  check: (value: { phone?: string; email?: string }) =>
    Boolean(value.phone || value.email),
  message:
    "Leave a phone number or an email — a directory entry nobody can reach is one nobody uses.",
};

export const alumniSchema = z
  .object({ ...alumniBody, studentId: z.string().uuid().optional().or(z.literal("")) })
  .refine(needsAContact.check, {
    message: needsAContact.message,
    path: ["phone"],
  });

export const publicAlumniSchema = z
  .object(alumniBody)
  .refine(needsAContact.check, {
    message: needsAContact.message,
    path: ["phone"],
  });

export const alumniEventSchema = z
  .object({
    title: z.string().min(2, "Give the event a name").max(200),
    eventDate: z.string().regex(DATE_SHAPE, "Use the date picker (YYYY-MM-DD)"),
    venue: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    /** Omitted is a free event; 0 is an event priced at nothing. */
    fee: z.number().min(0).optional(),
    capacity: z.number().int().min(1).optional(),
    registrationDeadline: optionalDate,
    isPublished: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !value.registrationDeadline ||
      value.registrationDeadline <= value.eventDate,
    {
      message: "Registration cannot close after the event has happened.",
      path: ["registrationDeadline"],
    },
  );

export type AlumniForm = z.infer<typeof alumniSchema>;
export type PublicAlumniForm = z.infer<typeof publicAlumniSchema>;
export type AlumniEventForm = z.infer<typeof alumniEventSchema>;

// ── donations ─────────────────────────────────────────────────────────

export const donationSchema = z.object({
  alumniId: z.string().uuid().optional().or(z.literal("")),
  donorName: z.string().min(2, "Who gave it?").max(160),
  donorPhone: optionalPhone,
  donorEmail: optionalEmail,
  /** Roadmap §7: amount > 0. Zero would print a receipt for nothing. */
  amount: z.number().min(0.01, "A donation must be more than zero"),
  purpose: z.string().max(200).optional(),
  method: z.enum(DONATION_METHOD_VALUES),
  receivedAt: optionalDate,
  remarks: z.string().max(1000).optional(),
  notify: z.boolean().optional(),
});

/** The only correction a receipt has (roadmap §6). */
export const cancelDonationSchema = z.object({
  reason: z
    .string()
    .min(3, "Say why the receipt is being cancelled — it stays in the register")
    .max(1000),
});

export type DonationForm = z.infer<typeof donationSchema>;
