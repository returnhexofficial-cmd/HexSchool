import { z } from "zod";

/** Mirrors the backend Transport Management DTOs (Module 25). */

export const VEHICLE_TYPE_VALUES = [
  "BUS",
  "MICROBUS",
  "VAN",
  "OTHER",
] as const;
export const VEHICLE_STATUS_VALUES = [
  "ACTIVE",
  "MAINTENANCE",
  "INACTIVE",
] as const;
export const DRIVER_STATUS_VALUES = [
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
] as const;
export const ROUTE_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;
export const EXPENSE_TYPE_VALUES = [
  "FUEL",
  "MAINTENANCE",
  "REPAIR",
  "TOLL",
  "OTHER",
] as const;

/** PROJECT_CONTEXT §12's BD mobile shape, mirrored from the DTO. */
export const BD_PHONE = /^01[3-9]\d{8}$/;
/** `HH:MM`, 24-hour — roadmap §7 "times HH:MM". */
export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalDate = z
  .string()
  .optional()
  .refine(
    (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use the date picker (YYYY-MM-DD)",
  );

/**
 * A registration plate is **free text** (roadmap §7): BD plates are
 * written half a dozen ways — "Dhaka Metro Ga 11-2345", "DHAKA-METRO-GA
 * 11 2345" — and a regex here would refuse real buses. The rule that
 * matters is uniqueness, and that is a database index, not a form.
 */
export const vehicleSchema = z.object({
  regNo: z.string().min(3, "At least 3 characters").max(40),
  type: z.enum(VEHICLE_TYPE_VALUES).optional(),
  capacity: z.coerce
    .number()
    .int("Whole seats only")
    .min(1, "A vehicle has at least one seat")
    .max(200, "That is more than a bus holds — check the number"),
  makeModel: z.string().max(120).optional(),
  modelYear: z.coerce.number().int().min(1950).max(2200).optional(),
  status: z.enum(VEHICLE_STATUS_VALUES).optional(),
  fitnessExpiry: optionalDate,
  taxTokenExpiry: optionalDate,
  insuranceExpiry: optionalDate,
  notes: z.string().max(2000).optional(),
});

export const driverSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(120),
  phone: z.string().regex(BD_PHONE, "A Bangladeshi mobile number, e.g. 01712345678"),
  licenseNo: z.string().min(3, "At least 3 characters").max(60),
  licenseExpiry: optionalDate,
  staffId: z.string().uuid().optional(),
  address: z.string().max(500).optional(),
  status: z.enum(DRIVER_STATUS_VALUES).optional(),
});

export const routeSchema = z
  .object({
    name: z.string().min(2, "At least 2 characters").max(160),
    nameBn: z.string().max(160).optional(),
    description: z.string().max(2000).optional(),
    vehicleId: z.string().uuid().nullable().optional(),
    driverId: z.string().uuid().nullable().optional(),
    substituteDriverId: z.string().uuid().nullable().optional(),
    helperName: z.string().max(120).optional(),
    helperPhone: z
      .string()
      .regex(BD_PHONE, "A Bangladeshi mobile number")
      .optional()
      .or(z.literal("")),
    status: z.enum(ROUTE_STATUS_VALUES).optional(),
  })
  .refine(
    (route) =>
      !route.driverId ||
      !route.substituteDriverId ||
      route.driverId !== route.substituteDriverId,
    {
      message:
        "The substitute cannot be the driver — the substitute exists because the driver is away",
      path: ["substituteDriverId"],
    },
  );

/**
 * The stop fee is what a family pays every month, so the form mirrors the
 * database's `monthly_fee >= 0` rather than trusting the server to say
 * no: a negative fare would hand money back, and the parent would find
 * out on an invoice.
 */
export const stopSchema = z
  .object({
    name: z.string().min(2, "At least 2 characters").max(160),
    landmark: z.string().max(200).optional(),
    pickupTime: z
      .string()
      .regex(CLOCK, "Use HH:MM, e.g. 07:10")
      .optional()
      .or(z.literal("")),
    dropTime: z
      .string()
      .regex(CLOCK, "Use HH:MM, e.g. 16:20")
      .optional()
      .or(z.literal("")),
    monthlyFee: z.coerce
      .number()
      .min(0, "A fare cannot be negative")
      .max(1_000_000),
    displayOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (stop) =>
      !stop.pickupTime ||
      !stop.dropTime ||
      stop.dropTime > stop.pickupTime,
    {
      message:
        "The afternoon drop should be after the morning pickup — one of the two looks like the wrong run",
      path: ["dropTime"],
    },
  );

export const assignmentSchema = z.object({
  enrollmentId: z.string().uuid("Pick a student"),
  routeId: z.string().uuid("Pick a route"),
  stopId: z.string().uuid("Pick a stop"),
  startDate: optionalDate,
  remarks: z.string().max(500).optional(),
  override: z.boolean().optional(),
});

export const bulkAssignSchema = z.object({
  routeId: z.string().uuid("Pick a route"),
  stopId: z.string().uuid("Pick a stop"),
  enrollmentIds: z
    .array(z.string().uuid())
    .min(1, "Pick at least one student")
    .max(300, "300 at a time is the batch limit"),
  startDate: optionalDate,
  override: z.boolean().optional(),
});

/** Suspending, ending and reassigning all demand a reason — the money
 *  they move is somebody's, and "why" is what an audit row needs. */
export const reasonSchema = z.object({
  reason: z.string().min(3, "Say why — this is audited").max(500),
  effectiveDate: optionalDate,
  endDate: optionalDate,
});

export const reassignSchema = z.object({
  fromRouteId: z.string().uuid("Pick the route to move riders from"),
  toRouteId: z.string().uuid("Pick the route to move them to"),
  toStopId: z.string().uuid().optional(),
  assignmentIds: z.array(z.string().uuid()).optional(),
  reason: z.string().min(3, "Say why — this is audited").max(500),
  override: z.boolean().optional(),
});

export const expenseSchema = z.object({
  vehicleId: z.string().uuid("Pick a vehicle"),
  type: z.enum(EXPENSE_TYPE_VALUES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  amount: z.coerce
    .number()
    .positive("An expense is more than zero")
    .max(100_000_000),
  odometer: z.coerce.number().int().min(0).max(10_000_000).optional(),
  description: z.string().max(1000).optional(),
  receiptUrl: z.string().url("A full https:// link").optional().or(z.literal("")),
});

export type VehicleFormValues = z.infer<typeof vehicleSchema>;
export type DriverFormValues = z.infer<typeof driverSchema>;
export type RouteFormValues = z.infer<typeof routeSchema>;
export type StopFormValues = z.infer<typeof stopSchema>;
export type AssignmentFormValues = z.infer<typeof assignmentSchema>;
export type ExpenseFormValues = z.infer<typeof expenseSchema>;
