import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Hostel Management API (Module 26): the buildings,
 * their rooms and beds, who sleeps in them and from when, the kitchen's
 * plans, the meal-off inbox, the four reports — and the portal's "where
 * does my child live" panel.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type HostelType = "BOYS" | "GIRLS";
export type HostelStatus = "ACTIVE" | "INACTIVE";
export type RoomType = "STANDARD" | "AC" | "SHARED";
export type RoomStatus = "ACTIVE" | "MAINTENANCE";
export type BedStatus = "VACANT" | "OCCUPIED" | "MAINTENANCE";
export type BedState = "FREE" | "TAKEN" | "MAINTENANCE";
export type AllocationStatus = "ACTIVE" | "SUSPENDED" | "VACATED";
export type MealOffStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const HOSTEL_TYPES: HostelType[] = ["BOYS", "GIRLS"];
export const ROOM_TYPES: RoomType[] = ["STANDARD", "AC", "SHARED"];
export const HOSTEL_STATUSES: HostelStatus[] = ["ACTIVE", "INACTIVE"];

export const HOSTEL_TYPE_LABELS: Record<HostelType, string> = {
  BOYS: "Boys",
  GIRLS: "Girls",
};

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  STANDARD: "Standard",
  AC: "Air-conditioned",
  SHARED: "Shared",
};

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  ACTIVE: "Living in",
  SUSPENDED: "Away — bed held",
  VACATED: "Moved out",
};

export const ALLOCATION_STATUS_VARIANT: Record<
  AllocationStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "default",
  SUSPENDED: "secondary",
  VACATED: "outline",
};

export const MEAL_OFF_STATUS_LABELS: Record<MealOffStatus, string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Refused",
  CANCELLED: "Withdrawn",
};

export const MEAL_OFF_VARIANT: Record<
  MealOffStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  CANCELLED: "outline",
};

/**
 * The colour a bed chip earns on the occupancy grid. Mirrors
 * `bedAvailability` on the server, which is the same function the report
 * and the allocation refusal use — so a grey chip and a 409 can never
 * disagree about what "taken" means.
 */
export const BED_STATE_CLASS: Record<BedState, string> = {
  FREE: "border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20",
  TAKEN: "border-primary/60 bg-primary/10",
  MAINTENANCE: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

export const BED_STATE_LABELS: Record<BedState, string> = {
  FREE: "Free",
  TAKEN: "Taken",
  MAINTENANCE: "Out of service",
};

// ── shapes ──────────────────────────────────────────────────────────────

export interface Occupancy {
  total: number;
  occupied: number;
  vacant: number;
  maintenance: number;
  available: number;
  utilization: number;
}

export interface Hostel {
  id: string;
  name: string;
  nameBn: string | null;
  type: HostelType;
  wardenStaffId: string | null;
  wardenStaff: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  } | null;
  address: string | null;
  phone: string | null;
  capacity: number;
  status: HostelStatus;
  notes: string | null;
}

export interface HostelSummary {
  hostel: Hostel;
  rooms: number;
  residents: number;
  occupancy: Occupancy;
  /** Set when the declared capacity and the real bed count disagree. */
  capacityNote: string | null;
}

export interface Bed {
  id: string;
  bedNo: string;
  status: BedStatus;
  notes: string | null;
  held: boolean;
}

export interface Room {
  id: string;
  hostelId: string;
  roomNo: string;
  floor: number;
  type: RoomType;
  bedCount: number;
  monthlyFee: number;
  status: RoomStatus;
  notes: string | null;
  beds: Bed[];
  occupancy: Occupancy;
  /** Roadmap §7's "bed_count = generated beds", reported not repaired. */
  bedCountNote: string | null;
}

export interface Allocation {
  id: string;
  enrollmentId: string;
  hostelId: string;
  bedId: string;
  startDate: string;
  endDate: string | null;
  status: AllocationStatus;
  suspendedAt: string | null;
  resumedAt: string | null;
  securityDeposit: string | number;
  depositRefunded: boolean;
  depositRefundAmount: string | number | null;
  depositRefundedAt: string | null;
  statusReason: string | null;
  remarks: string | null;
  hostel: {
    id: string;
    name: string;
    type: HostelType;
    status: HostelStatus;
    phone: string | null;
    wardenStaff: { id: string; firstName: string; lastName: string } | null;
  };
  bed: {
    id: string;
    bedNo: string;
    status: BedStatus;
    room: {
      id: string;
      roomNo: string;
      floor: number;
      type: RoomType;
      status: RoomStatus;
      monthlyFee: string | number;
    };
  };
  enrollment: {
    id: string;
    rollNo: number | null;
    sessionId: string;
    status: string;
    student: {
      id: string;
      studentUid: string;
      firstName: string;
      lastName: string;
      gender: string;
      photoUrl: string | null;
    };
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
  };
  messEnrollments: Array<{
    id: string;
    startDate: string;
    endDate: string | null;
    plan: { id: string; name: string; monthlyCharge: string | number };
  }>;
}

export interface AllocationResult {
  allocation: Allocation;
  warnings: string[];
}

export interface MessPlan {
  id: string;
  hostelId: string;
  name: string;
  description: string | null;
  monthlyCharge: number;
  status: HostelStatus;
  subscribers: number;
}

export interface MessEnrollment {
  id: string;
  hostelId: string;
  allocationId: string;
  planId: string;
  startDate: string;
  endDate: string | null;
  plan: {
    id: string;
    name: string;
    monthlyCharge: string | number;
    status: HostelStatus;
  };
  allocation: {
    id: string;
    hostelId: string;
    status: AllocationStatus;
    enrollment: {
      id: string;
      rollNo: number | null;
      student: {
        id: string;
        studentUid: string;
        firstName: string;
        lastName: string;
      };
    };
  };
}

export interface MealOff {
  id: string;
  allocationId: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: MealOffStatus;
  approvedAt: string | null;
  decisionNote: string | null;
  /** The month whose invoice carries the credit; set at approval. */
  creditMonth: string | null;
  allocation: {
    id: string;
    hostelId: string;
    hostel: { id: string; name: string };
    enrollment: {
      id: string;
      rollNo: number | null;
      student: {
        id: string;
        studentUid: string;
        firstName: string;
        lastName: string;
      };
    };
  };
}

export interface OccupancyReport {
  generatedAt: string;
  overall: Occupancy;
  hostels: Array<{
    hostelId: string;
    hostelName: string;
    type: string;
    occupancy: Occupancy;
    capacityNote: string | null;
    floors: Array<{
      floor: number;
      occupancy: Occupancy;
      rooms: Array<{
        roomId: string;
        roomNo: string;
        type: string;
        status: string;
        monthlyFee: number;
        occupancy: Occupancy;
        bedCountNote: string | null;
        beds: Array<{ bedId: string; bedNo: string; state: BedState }>;
      }>;
    }>;
  }>;
}

export interface ResidentRow {
  allocationId: string;
  studentUid: string;
  studentName: string;
  className: string;
  sectionName: string | null;
  rollNo: number | null;
  hostelName: string;
  roomNo: string;
  bedNo: string;
  status: string;
  startDate: string;
  monthlyFee: number;
  messPlan: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelation: string | null;
}

export interface DuesRow extends Omit<ResidentRow, "guardianRelation"> {
  outstanding: number;
}

export interface MealOffSummaryRow {
  studentUid: string;
  studentName: string;
  hostelName: string;
  requested: number;
  approved: number;
  rejected: number;
  daysRequested: number;
  daysApproved: number;
}

export interface PortalHostelView {
  resident: boolean;
  reason?: string;
  hostel?: {
    name: string;
    type: string;
    phone: string | null;
    wardenName: string | null;
  };
  room?: {
    roomNo: string;
    floor: number;
    type: string;
    bedNo: string;
    monthlyFee: number;
  };
  mess?: {
    planName: string;
    monthlyCharge: number;
    startDate: string;
  } | null;
  status?: AllocationStatus;
  startDate?: string;
  securityDeposit?: number;
  mealOffs?: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
    status: MealOffStatus;
    decisionNote: string | null;
  }>;
}

// ── inputs ──────────────────────────────────────────────────────────────

export interface HostelInput {
  name: string;
  nameBn?: string;
  type: HostelType;
  wardenStaffId?: string;
  address?: string;
  phone?: string;
  capacity?: number;
  status?: HostelStatus;
  notes?: string;
}

export interface RoomInput {
  roomNo: string;
  floor?: number;
  type?: RoomType;
  bedCount: number;
  monthlyFee: number;
  status?: RoomStatus;
  notes?: string;
  generateBeds?: boolean;
}

export interface AllocationInput {
  enrollmentId: string;
  bedId: string;
  startDate?: string;
  securityDeposit?: number;
  messPlanId?: string;
  remarks?: string;
  override?: boolean;
}

export interface MessPlanInput {
  hostelId: string;
  name: string;
  description?: string;
  monthlyCharge: number;
  status?: HostelStatus;
}

export interface MealOffInput {
  allocationId: string;
  fromDate: string;
  toDate: string;
  reason: string;
}

export interface DeductionInput {
  amount: number;
  reason: string;
}

// ── helpers ─────────────────────────────────────────────────────────────

/** BDT, two decimals — the same helper shape M25 uses. */
export function formatBdt(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";
}

/**
 * Downloads honour the server's `Content-Disposition` filename and fall
 * back to ours — the M25 download contract, unchanged.
 */
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

function hostelParam(hostelId?: string): string {
  return hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : "";
}

const unwrap = <T>(res: { data: ApiEnvelope<T> }): T => res.data.data;

// ── clients ─────────────────────────────────────────────────────────────

export const hostelApi = {
  list: async (params?: {
    status?: HostelStatus;
    type?: HostelType;
    search?: string;
  }) => unwrap<HostelSummary[]>(await api.get("/hostels", { params })),

  get: async (id: string) =>
    unwrap<HostelSummary>(await api.get(`/hostels/${id}`)),

  create: async (input: HostelInput) =>
    unwrap<HostelSummary>(await api.post("/hostels", input)),

  update: async (id: string, input: HostelInput) =>
    unwrap<HostelSummary>(await api.patch(`/hostels/${id}`, input)),

  remove: async (id: string) => {
    await api.delete(`/hostels/${id}`);
  },

  rooms: async (
    hostelId: string,
    params?: { status?: RoomStatus; floor?: number },
  ) => unwrap<Room[]>(await api.get(`/hostels/${hostelId}/rooms`, { params })),

  createRoom: async (hostelId: string, input: RoomInput) =>
    unwrap<Room>(await api.post(`/hostels/${hostelId}/rooms`, input)),

  updateRoom: async (roomId: string, input: RoomInput) =>
    unwrap<Room>(await api.patch(`/hostels/rooms/${roomId}`, input)),

  removeRoom: async (roomId: string) => {
    await api.delete(`/hostels/rooms/${roomId}`);
  },

  generateBeds: async (
    roomId: string,
    input: { count: number; prefix?: string },
  ) => unwrap<Room>(await api.post(`/hostels/rooms/${roomId}/beds`, input)),

  updateBed: async (
    bedId: string,
    input: { bedNo: string; status?: BedStatus; notes?: string },
  ) => unwrap<Bed>(await api.patch(`/hostels/beds/${bedId}`, input)),

  removeBed: async (bedId: string) => {
    await api.delete(`/hostels/beds/${bedId}`);
  },
};

export const allocationApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    hostelId?: string;
    roomId?: string;
    sessionId?: string;
    classId?: string;
    sectionId?: string;
    studentId?: string;
    status?: AllocationStatus;
    search?: string;
  }) => {
    const res = await api.get<ApiEnvelope<Allocation[]>>(
      "/hostel-allocations",
      { params },
    );
    return { data: res.data.data, meta: res.data.meta };
  },

  get: async (id: string) =>
    unwrap<Allocation>(await api.get(`/hostel-allocations/${id}`)),

  create: async (input: AllocationInput) =>
    unwrap<AllocationResult>(await api.post("/hostel-allocations", input)),

  bulk: async (input: {
    enrollmentIds: string[];
    hostelId: string;
    startDate?: string;
    securityDeposit?: number;
    override?: boolean;
  }) =>
    unwrap<{
      allocated: number;
      skipped: Array<{ enrollmentId: string; reason: string }>;
      warnings: string[];
    }>(await api.post("/hostel-allocations/bulk", input)),

  transfer: async (
    id: string,
    input: { bedId: string; reason: string; override?: boolean },
  ) =>
    unwrap<AllocationResult>(
      await api.post(`/hostel-allocations/${id}/transfer`, input),
    ),

  suspend: async (
    id: string,
    input: { reason: string; effectiveDate?: string },
  ) =>
    unwrap<Allocation>(
      await api.post(`/hostel-allocations/${id}/suspend`, input),
    ),

  resume: async (id: string, input: { effectiveDate?: string }) =>
    unwrap<Allocation>(
      await api.post(`/hostel-allocations/${id}/resume`, input),
    ),

  vacate: async (
    id: string,
    input: { reason: string; endDate?: string; override?: boolean },
  ) =>
    unwrap<AllocationResult>(
      await api.post(`/hostel-allocations/${id}/vacate`, input),
    ),

  refundDeposit: async (
    id: string,
    input: {
      deductions?: DeductionInput[];
      refundedAt?: string;
      note?: string;
    },
  ) =>
    unwrap<{
      allocation: Allocation;
      refund: number;
      withheld: number;
      warnings: string[];
    }>(await api.post(`/hostel-allocations/${id}/refund-deposit`, input)),
};

export const messApi = {
  plans: async (params?: { hostelId?: string; status?: HostelStatus }) =>
    unwrap<MessPlan[]>(await api.get("/mess-plans", { params })),

  createPlan: async (input: MessPlanInput) =>
    unwrap<MessPlan>(await api.post("/mess-plans", input)),

  updatePlan: async (id: string, input: MessPlanInput) =>
    unwrap<MessPlan>(await api.patch(`/mess-plans/${id}`, input)),

  removePlan: async (id: string) => {
    await api.delete(`/mess-plans/${id}`);
  },

  enrollments: async (params?: {
    hostelId?: string;
    allocationId?: string;
    planId?: string;
  }) =>
    unwrap<MessEnrollment[]>(await api.get("/mess-enrollments", { params })),

  enroll: async (input: {
    allocationId: string;
    planId: string;
    startDate?: string;
  }) => unwrap<MessEnrollment>(await api.post("/mess-enrollments", input)),

  endEnrollment: async (id: string, input: { endDate?: string }) =>
    unwrap<MessEnrollment>(
      await api.post(`/mess-enrollments/${id}/end`, input),
    ),
};

export const mealOffApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    hostelId?: string;
    allocationId?: string;
    status?: MealOffStatus;
    from?: string;
    to?: string;
  }) => {
    const res = await api.get<ApiEnvelope<MealOff[]>>("/meal-offs", {
      params,
    });
    return { data: res.data.data, meta: res.data.meta };
  },

  create: async (input: MealOffInput) =>
    unwrap<MealOff>(await api.post("/meal-offs", input)),

  update: async (
    id: string,
    input: { fromDate?: string; toDate?: string; reason?: string },
  ) => unwrap<MealOff>(await api.patch(`/meal-offs/${id}`, input)),

  decide: async (id: string, input: { approve: boolean; note?: string }) =>
    unwrap<MealOff>(await api.post(`/meal-offs/${id}/approve`, input)),

  cancel: async (id: string) =>
    unwrap<MealOff>(await api.post(`/meal-offs/${id}/cancel`, {})),
};

export const hostelReportApi = {
  occupancy: async (params?: { hostelId?: string }) =>
    unwrap<OccupancyReport>(
      await api.get("/hostel/reports/occupancy", { params }),
    ),

  residents: async (params?: { hostelId?: string; sessionId?: string }) =>
    unwrap<ResidentRow[]>(
      await api.get("/hostel/reports/residents", { params }),
    ),

  dues: async (params?: { hostelId?: string; sessionId?: string }) =>
    unwrap<DuesRow[]>(await api.get("/hostel/reports/dues", { params })),

  mealOffs: async (params?: {
    hostelId?: string;
    from?: string;
    to?: string;
  }) =>
    unwrap<MealOffSummaryRow[]>(
      await api.get("/hostel/reports/meal-offs", { params }),
    ),

  downloadOccupancy: (hostelId?: string) =>
    downloadFile(
      `/hostel/reports/occupancy/export${hostelParam(hostelId)}`,
      "hostel-occupancy.xlsx",
    ),

  downloadResidents: (hostelId?: string) =>
    downloadFile(
      `/hostel/reports/residents/export${hostelParam(hostelId)}`,
      "hostel-residents.xlsx",
    ),

  printResidents: (hostelId?: string) =>
    downloadFile(
      `/hostel/reports/residents/print${hostelParam(hostelId)}`,
      "hostel-residents.pdf",
    ),

  downloadDues: (hostelId?: string) =>
    downloadFile(
      `/hostel/reports/dues/export${hostelParam(hostelId)}`,
      "hostel-dues.xlsx",
    ),

  downloadMealOffs: (hostelId?: string) =>
    downloadFile(
      `/hostel/reports/meal-offs/export${hostelParam(hostelId)}`,
      "hostel-meal-offs.xlsx",
    ),
};

export const hostelPortalApi = {
  mine: async () =>
    unwrap<PortalHostelView>(await api.get("/portal/hostel")),

  forChild: async (childId: string) =>
    unwrap<PortalHostelView>(
      await api.get(`/portal/parent/child/${childId}/hostel`),
    ),
};
