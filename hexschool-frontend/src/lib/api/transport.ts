import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Transport Management API (Module 25): the fleet and
 * its papers, drivers, routes and their stops, riders and their service
 * windows, vehicle expenses, the four reports — and the portal's "which
 * bus does my child take" panel.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type VehicleType = "BUS" | "MICROBUS" | "VAN" | "OTHER";
export type VehicleStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";
export type DriverStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE";
export type RouteStatus = "ACTIVE" | "INACTIVE";
export type AssignmentStatus = "ACTIVE" | "SUSPENDED" | "ENDED";
export type ExpenseType = "FUEL" | "MAINTENANCE" | "REPAIR" | "TOLL" | "OTHER";
export type ExpiryState = "UNKNOWN" | "EXPIRED" | "DUE_SOON" | "OK";
export type CapacityState = "UNKNOWN" | "SPACE" | "FULL" | "OVER";

export const VEHICLE_TYPES: VehicleType[] = ["BUS", "MICROBUS", "VAN", "OTHER"];
export const VEHICLE_STATUSES: VehicleStatus[] = [
  "ACTIVE",
  "MAINTENANCE",
  "INACTIVE",
];
export const DRIVER_STATUSES: DriverStatus[] = [
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
];
export const EXPENSE_TYPES: ExpenseType[] = [
  "FUEL",
  "MAINTENANCE",
  "REPAIR",
  "TOLL",
  "OTHER",
];

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  ACTIVE: "On the road",
  MAINTENANCE: "In the workshop",
  INACTIVE: "Off the fleet",
};

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  ACTIVE: "Driving",
  ON_LEAVE: "On leave",
  INACTIVE: "Inactive",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ACTIVE: "Riding",
  SUSPENDED: "Suspended",
  ENDED: "Ended",
};

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  FUEL: "Fuel",
  MAINTENANCE: "Maintenance",
  REPAIR: "Repair",
  TOLL: "Toll",
  OTHER: "Other",
};

/** The badge colour a document state earns. */
export const EXPIRY_VARIANT: Record<
  ExpiryState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  EXPIRED: "destructive",
  DUE_SOON: "secondary",
  UNKNOWN: "outline",
  OK: "default",
};

export const EXPIRY_LABELS: Record<ExpiryState, string> = {
  EXPIRED: "Expired",
  DUE_SOON: "Expiring",
  UNKNOWN: "Not recorded",
  OK: "Current",
};

export const CAPACITY_VARIANT: Record<
  CapacityState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  OVER: "destructive",
  FULL: "secondary",
  SPACE: "default",
  UNKNOWN: "outline",
};

// ── shapes ──────────────────────────────────────────────────────────────

export interface ExpiryItem {
  kind: "FITNESS" | "TAX_TOKEN" | "INSURANCE" | "LICENSE";
  label: string;
  expiry: string | null;
  daysLeft: number | null;
  state: ExpiryState;
}

export interface Vehicle {
  id: string;
  regNo: string;
  type: VehicleType;
  capacity: number;
  makeModel: string | null;
  modelYear: number | null;
  status: VehicleStatus;
  fitnessExpiry: string | null;
  taxTokenExpiry: string | null;
  insuranceExpiry: string | null;
  notes: string | null;
  documents: ExpiryItem[];
  documentState: ExpiryState;
  routes: number;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNo: string;
  licenseExpiry: string | null;
  address: string | null;
  status: DriverStatus;
  staffId: string | null;
  staff: { id: string; employeeId: string; designation: string } | null;
  documents: ExpiryItem[];
  documentState: ExpiryState;
  routes: number;
}

export interface RouteStop {
  id: string;
  routeId: string;
  name: string;
  landmark: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  monthlyFee: string;
  displayOrder: number;
}

export interface CapacityStatus {
  state: CapacityState;
  capacity: number | null;
  assigned: number;
  projected: number;
  seatsLeft: number | null;
  utilization: number | null;
  message: string | null;
}

export interface Route {
  id: string;
  name: string;
  nameBn: string | null;
  description: string | null;
  status: RouteStatus;
  helperName: string | null;
  helperPhone: string | null;
  vehicleId: string | null;
  driverId: string | null;
  substituteDriverId: string | null;
  vehicle: {
    id: string;
    regNo: string;
    capacity: number;
    status: VehicleStatus;
    type: VehicleType;
  } | null;
  driver: { id: string; name: string; phone: string; status: DriverStatus } | null;
  substituteDriver: { id: string; name: string; phone: string } | null;
  stops: RouteStop[];
  capacity: CapacityStatus;
  window: { firstPickup: string | null; lastDrop: string | null };
  issues: Array<{ stopId: string; stopName: string; message: string }>;
  stopLoads: Array<{ stopId: string; stopName: string; riders: number }>;
}

export interface Assignment {
  id: string;
  status: AssignmentStatus;
  startDate: string;
  endDate: string | null;
  suspendedAt: string | null;
  resumedAt: string | null;
  statusReason: string | null;
  remarks: string | null;
  routeId: string;
  stopId: string;
  enrollmentId: string;
  route: {
    id: string;
    name: string;
    vehicle: { id: string; regNo: string; capacity: number } | null;
    driver: { id: string; name: string; phone: string } | null;
  };
  stop: {
    id: string;
    name: string;
    pickupTime: string | null;
    dropTime: string | null;
    monthlyFee: string;
  };
  enrollment: {
    id: string;
    rollNo: number;
    student: {
      id: string;
      studentUid: string;
      firstName: string;
      lastName: string;
    };
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
  };
}

export interface VehicleExpense {
  id: string;
  vehicleId: string;
  type: ExpenseType;
  date: string;
  amount: string;
  odometer: number | null;
  description: string | null;
  receiptUrl: string | null;
  voucherId: string | null;
  vehicle: { id: string; regNo: string; type: VehicleType };
}

export interface TransportAlerts {
  windowDays: number;
  total: number;
  vehicles: Array<{
    id: string;
    kind: "VEHICLE";
    label: string;
    status: VehicleStatus;
    items: ExpiryItem[];
  }>;
  drivers: Array<{
    id: string;
    kind: "DRIVER";
    label: string;
    status: DriverStatus;
    items: ExpiryItem[];
  }>;
}

export interface RouteRoster {
  route: {
    id: string;
    name: string;
    vehicleRegNo: string | null;
    driverName: string | null;
    driverPhone: string | null;
    substituteDriverName: string | null;
    helperName: string | null;
    helperPhone: string | null;
    firstPickup: string | null;
    lastDrop: string | null;
  };
  capacity: CapacityStatus;
  stops: Array<{ stopId: string; stopName: string; riders: number }>;
  riders: Array<{
    assignmentId: string;
    studentUid: string;
    studentName: string;
    className: string;
    sectionName: string | null;
    rollNo: number;
    stopName: string;
    pickupTime: string | null;
    dropTime: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
    monthlyFee: number;
    status: AssignmentStatus;
    remarks: string | null;
  }>;
  generatedAt: string;
}

export interface ExpenseReport {
  summary: {
    total: number;
    count: number;
    fuelTotal: number;
    byType: Array<{
      type: ExpenseType;
      total: number;
      count: number;
      share: number;
    }>;
    distance: { km: number; readings: number; brokenChains: number };
    fuelCostPerKm: number | null;
    totalCostPerKm: number | null;
  };
  series: Array<{ month: string; total: number; fuel: number; count: number }>;
  byVehicle: Array<{
    vehicleId: string;
    regNo: string;
    total: number;
    fuel: number;
    km: number;
    costPerKm: number | null;
  }>;
}

export interface UtilizationReport {
  fleet: {
    routes: number;
    measurable: number;
    seats: number;
    riders: number;
    utilization: number | null;
    overCapacity: number;
  };
  routes: Array<{
    routeId: string;
    routeName: string;
    vehicleRegNo: string | null;
    capacity: number | null;
    riders: number;
    utilization: number | null;
    state: CapacityState;
    expectedMonthly: number;
  }>;
}

export interface CollectionReport {
  month: string;
  feeHead: { id: string; name: string } | null;
  routes: Array<{
    routeId: string;
    routeName: string;
    riders: number;
    expected: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  }>;
  totals: {
    riders: number;
    expected: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  };
  note: string;
}

/** The portal projection — deliberately thin (see the backend service). */
export interface PortalTransport {
  assigned: boolean;
  reason?: string;
  route?: {
    name: string;
    vehicleRegNo: string | null;
    driverName: string | null;
    driverPhone: string | null;
    substituteDriverName: string | null;
    helperName: string | null;
    helperPhone: string | null;
  };
  stop?: {
    name: string;
    pickupTime: string | null;
    dropTime: string | null;
    monthlyFee: number;
  };
  status?: AssignmentStatus;
  startDate?: string;
  remarks?: string | null;
}

// ── helpers ─────────────────────────────────────────────────────────────

function params(query: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null,
    ),
  );
}

async function unwrap<T>(path: string, query: object = {}): Promise<T> {
  const res = await api.get<ApiEnvelope<T>>(path, { params: params(query) });
  return res.data.data;
}

/** One unwrap, not two — the M18 lesson (`meta` is lifted, rows stay). */
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

export function formatBdt(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";
}

// ── vehicles & drivers ──────────────────────────────────────────────────

export interface VehicleInput {
  regNo: string;
  type?: VehicleType;
  capacity: number;
  makeModel?: string;
  modelYear?: number;
  status?: VehicleStatus;
  fitnessExpiry?: string;
  taxTokenExpiry?: string;
  insuranceExpiry?: string;
  notes?: string;
}

export interface DriverInput {
  name: string;
  phone: string;
  licenseNo: string;
  licenseExpiry?: string;
  staffId?: string;
  address?: string;
  status?: DriverStatus;
}

export const vehicleApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: VehicleStatus;
      type?: VehicleType;
    } = {},
  ) => paginated<Vehicle>("/transport/vehicles", query),

  get: (id: string) => unwrap<Vehicle>(`/transport/vehicles/${id}`),

  async create(
    input: VehicleInput,
  ): Promise<{ vehicle: Vehicle; warnings: string[] }> {
    const res = await api.post<
      ApiEnvelope<{ vehicle: Vehicle; warnings: string[] }>
    >("/transport/vehicles", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: VehicleInput,
  ): Promise<{ vehicle: Vehicle; warnings: string[] }> {
    const res = await api.patch<
      ApiEnvelope<{ vehicle: Vehicle; warnings: string[] }>
    >(`/transport/vehicles/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/transport/vehicles/${id}`);
  },
};

export const driverApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: DriverStatus;
    } = {},
  ) => paginated<Driver>("/transport/drivers", query),

  get: (id: string) => unwrap<Driver>(`/transport/drivers/${id}`),

  async create(
    input: DriverInput,
  ): Promise<{ driver: Driver; warnings: string[] }> {
    const res = await api.post<
      ApiEnvelope<{ driver: Driver; warnings: string[] }>
    >("/transport/drivers", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: DriverInput,
  ): Promise<{ driver: Driver; warnings: string[] }> {
    const res = await api.patch<
      ApiEnvelope<{ driver: Driver; warnings: string[] }>
    >(`/transport/drivers/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/transport/drivers/${id}`);
  },
};

export const transportAlertsApi = {
  list: () => unwrap<TransportAlerts>("/transport/alerts"),
};

// ── routes & stops ──────────────────────────────────────────────────────

export interface RouteInput {
  name: string;
  nameBn?: string;
  description?: string;
  vehicleId?: string | null;
  driverId?: string | null;
  substituteDriverId?: string | null;
  helperName?: string;
  helperPhone?: string;
  status?: RouteStatus;
}

export interface StopInput {
  name: string;
  landmark?: string;
  pickupTime?: string;
  dropTime?: string;
  monthlyFee: number;
  displayOrder?: number;
}

export const routeApi = {
  list: (
    query: { status?: RouteStatus; vehicleId?: string; search?: string } = {},
  ) => unwrap<Route[]>("/transport/routes", query),

  get: (id: string) => unwrap<Route>(`/transport/routes/${id}`),

  async create(input: RouteInput): Promise<Route> {
    const res = await api.post<ApiEnvelope<Route>>("/transport/routes", input);
    return res.data.data;
  },

  async update(id: string, input: RouteInput): Promise<Route> {
    const res = await api.patch<ApiEnvelope<Route>>(
      `/transport/routes/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/transport/routes/${id}`);
  },

  async addStop(routeId: string, input: StopInput): Promise<Route> {
    const res = await api.post<ApiEnvelope<Route>>(
      `/transport/routes/${routeId}/stops`,
      input,
    );
    return res.data.data;
  },

  async updateStop(
    routeId: string,
    stopId: string,
    input: StopInput,
  ): Promise<Route> {
    const res = await api.patch<ApiEnvelope<Route>>(
      `/transport/routes/${routeId}/stops/${stopId}`,
      input,
    );
    return res.data.data;
  },

  async removeStop(routeId: string, stopId: string): Promise<void> {
    await api.delete(`/transport/routes/${routeId}/stops/${stopId}`);
  },

  async reorderStops(routeId: string, stopIds: string[]): Promise<Route> {
    const res = await api.put<ApiEnvelope<Route>>(
      `/transport/routes/${routeId}/stops/order`,
      { stopIds },
    );
    return res.data.data;
  },
};

// ── assignments ─────────────────────────────────────────────────────────

export const assignmentApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      routeId?: string;
      stopId?: string;
      sessionId?: string;
      classId?: string;
      sectionId?: string;
      status?: AssignmentStatus;
    } = {},
  ) => paginated<Assignment>("/transport/assignments", query),

  forStudent: (studentId: string, sessionId?: string) =>
    unwrap<Assignment | null>(`/transport/students/${studentId}`, {
      sessionId,
    }),

  async create(input: {
    enrollmentId: string;
    routeId: string;
    stopId: string;
    startDate?: string;
    remarks?: string;
    override?: boolean;
  }): Promise<{ assignment: Assignment; warnings: string[] }> {
    const res = await api.post<
      ApiEnvelope<{ assignment: Assignment; warnings: string[] }>
    >("/transport/assignments", input);
    return res.data.data;
  },

  async bulk(input: {
    routeId: string;
    stopId: string;
    enrollmentIds: string[];
    startDate?: string;
    override?: boolean;
  }): Promise<{
    assigned: number;
    skipped: Array<{ enrollmentId: string; reason: string }>;
    warnings: string[];
  }> {
    const res = await api.post<
      ApiEnvelope<{
        assigned: number;
        skipped: Array<{ enrollmentId: string; reason: string }>;
        warnings: string[];
      }>
    >("/transport/assignments/bulk", input);
    return res.data.data;
  },

  async reassign(input: {
    fromRouteId: string;
    toRouteId: string;
    assignmentIds?: string[];
    toStopId?: string;
    reason: string;
    override?: boolean;
  }): Promise<{
    moved: number;
    unmatched: Array<{ assignmentId: string; reason: string }>;
    warnings: string[];
  }> {
    const res = await api.post<
      ApiEnvelope<{
        moved: number;
        unmatched: Array<{ assignmentId: string; reason: string }>;
        warnings: string[];
      }>
    >("/transport/assignments/reassign", input);
    return res.data.data;
  },

  async move(
    id: string,
    input: { routeId?: string; stopId?: string; remarks?: string; override?: boolean },
  ): Promise<{ assignment: Assignment; warnings: string[] }> {
    const res = await api.patch<
      ApiEnvelope<{ assignment: Assignment; warnings: string[] }>
    >(`/transport/assignments/${id}`, input);
    return res.data.data;
  },

  async suspend(
    id: string,
    input: { reason: string; effectiveDate?: string },
  ): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/transport/assignments/${id}/suspend`,
      input,
    );
    return res.data.data;
  },

  async resume(id: string, input: { effectiveDate?: string } = {}): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/transport/assignments/${id}/resume`,
      input,
    );
    return res.data.data;
  },

  async end(
    id: string,
    input: { reason: string; endDate?: string },
  ): Promise<Assignment> {
    const res = await api.post<ApiEnvelope<Assignment>>(
      `/transport/assignments/${id}/end`,
      input,
    );
    return res.data.data;
  },
};

// ── expenses ────────────────────────────────────────────────────────────

export interface ExpenseInput {
  vehicleId: string;
  type: ExpenseType;
  date: string;
  amount: number;
  odometer?: number;
  description?: string;
  receiptUrl?: string;
}

export const expenseApi = {
  list: (
    query: {
      page?: number;
      limit?: number;
      vehicleId?: string;
      type?: ExpenseType;
      from?: string;
      to?: string;
    } = {},
  ) => paginated<VehicleExpense>("/transport/expenses", query),

  async create(
    input: ExpenseInput,
  ): Promise<{ expense: VehicleExpense; warnings: string[] }> {
    const res = await api.post<
      ApiEnvelope<{ expense: VehicleExpense; warnings: string[] }>
    >("/transport/expenses", input);
    return res.data.data;
  },

  async update(
    id: string,
    input: ExpenseInput,
  ): Promise<{ expense: VehicleExpense; warnings: string[] }> {
    const res = await api.patch<
      ApiEnvelope<{ expense: VehicleExpense; warnings: string[] }>
    >(`/transport/expenses/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/transport/expenses/${id}`);
  },
};

// ── reports ─────────────────────────────────────────────────────────────

export const transportReportApi = {
  roster: (routeId: string) =>
    unwrap<RouteRoster>(`/transport/reports/roster/${routeId}`),

  expenses: (query: { vehicleId?: string; from?: string; to?: string } = {}) =>
    unwrap<ExpenseReport>("/transport/reports/expenses", query),

  utilization: () => unwrap<UtilizationReport>("/transport/reports/utilization"),

  collection: (month?: string) =>
    unwrap<CollectionReport>("/transport/reports/collection", { month }),

  downloadRoster: (routeId: string) =>
    downloadFile(
      `/transport/reports/roster/${routeId}/export`,
      "route-roster.xlsx",
    ),

  printRoster: (routeId: string) =>
    downloadFile(
      `/transport/reports/roster/${routeId}/print`,
      "route-roster.pdf",
    ),

  downloadExpenses: (query: { vehicleId?: string; from?: string; to?: string } = {}) => {
    const search = new URLSearchParams(
      params(query) as Record<string, string>,
    ).toString();
    return downloadFile(
      `/transport/reports/expenses/export${search ? `?${search}` : ""}`,
      "transport-expenses.xlsx",
    );
  },

  downloadUtilization: () =>
    downloadFile(
      "/transport/reports/utilization/export",
      "transport-utilization.xlsx",
    ),

  downloadCollection: (month?: string) =>
    downloadFile(
      `/transport/reports/collection/export${month ? `?month=${month}` : ""}`,
      "transport-collection.xlsx",
    ),
};

// ── the portal panel ────────────────────────────────────────────────────

export const portalTransportApi = {
  me: () => unwrap<PortalTransport>("/portal/transport"),
  child: (childId: string) =>
    unwrap<PortalTransport>(`/portal/parent/child/${childId}/transport`),
};
