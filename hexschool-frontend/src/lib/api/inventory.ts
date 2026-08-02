import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Inventory & Assets API (Module 24): suppliers, the
 * item catalogue, purchases and their receipt, the issue desk, stock
 * adjustments, the asset register and the six reports.
 *
 * The one thing worth knowing before reading further: **there is no
 * quantity column anywhere.** Every balance on these types comes from the
 * stock ledger, computed server-side, which is why nothing here ever
 * sends one.
 */

// ── enums (kept in step with prisma/schema.prisma) ─────────────────────

export type ItemType = "ASSET" | "CONSUMABLE";
export type ItemUnit =
  | "PCS"
  | "BOX"
  | "REAM"
  | "SET"
  | "LITER"
  | "KG"
  | "OTHER";
export type SupplierStatus = "ACTIVE" | "INACTIVE" | "BLACKLISTED";
export type PurchaseStatus = "DRAFT" | "RECEIVED" | "CANCELLED";
export type StockTxn = "PURCHASE" | "ISSUE" | "RETURN" | "ADJUST" | "DISPOSE";
export type AssetStatus =
  | "IN_STORE"
  | "ASSIGNED"
  | "UNDER_REPAIR"
  | "DISPOSED"
  | "LOST";
export type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "UNSERVICEABLE";
export type HolderType = "DEPARTMENT" | "PERSON" | "ROOM";
export type PersonType = "TEACHER" | "STAFF";
export type IssueStatus = "ISSUED" | "PARTIAL_RETURN" | "RETURNED";
export type WarrantyState = "UNKNOWN" | "ACTIVE" | "EXPIRING" | "EXPIRED";

export const ITEM_TYPES: ItemType[] = ["ASSET", "CONSUMABLE"];
export const ITEM_UNITS: ItemUnit[] = [
  "PCS",
  "BOX",
  "REAM",
  "SET",
  "LITER",
  "KG",
  "OTHER",
];
export const SUPPLIER_STATUSES: SupplierStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "BLACKLISTED",
];
export const ASSET_CONDITIONS: AssetCondition[] = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "UNSERVICEABLE",
];
export const HOLDER_TYPES: HolderType[] = ["DEPARTMENT", "PERSON", "ROOM"];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  ASSET: "Asset (tagged)",
  CONSUMABLE: "Consumable (counted)",
};

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  BLACKLISTED: "Blacklisted",
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: "Draft",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_STORE: "In store",
  ASSIGNED: "Assigned",
  UNDER_REPAIR: "Under repair",
  DISPOSED: "Disposed",
  LOST: "Lost",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  ISSUED: "Out",
  PARTIAL_RETURN: "Partly back",
  RETURNED: "Returned",
};

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  DEPARTMENT: "Department",
  PERSON: "A person",
  ROOM: "A room",
};

export const TXN_LABELS: Record<StockTxn, string> = {
  PURCHASE: "Received",
  ISSUE: "Issued",
  RETURN: "Returned",
  ADJUST: "Adjusted",
  DISPOSE: "Disposed",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const PURCHASE_STATUS_VARIANT: Record<PurchaseStatus, BadgeVariant> = {
  DRAFT: "outline",
  RECEIVED: "default",
  CANCELLED: "destructive",
};

export const ASSET_STATUS_VARIANT: Record<AssetStatus, BadgeVariant> = {
  IN_STORE: "secondary",
  ASSIGNED: "default",
  UNDER_REPAIR: "outline",
  DISPOSED: "destructive",
  LOST: "destructive",
};

/**
 * A warranty that was never recorded is **not** fine. It shares the
 * warning colour with one that is about to lapse, because the projector
 * nobody wrote a date for is the one most likely to be out of cover.
 */
export const WARRANTY_VARIANT: Record<WarrantyState, BadgeVariant> = {
  ACTIVE: "secondary",
  EXPIRING: "outline",
  UNKNOWN: "outline",
  EXPIRED: "destructive",
};

// ── helpers ────────────────────────────────────────────────────────────

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

/**
 * A quantity as a store register writes it — trailing zeros dropped. The
 * server's `formatQty` does the same thing; both exist because
 * `NUMERIC(14,3)` comes back as "12.000" and nobody writes that on a gate
 * pass.
 */
export function formatQty(
  value: number | string | null | undefined,
  unit?: string,
): string {
  const qty = Number(value ?? 0);
  if (!Number.isFinite(qty)) return unit ? `0 ${unit}` : "0";
  const text = Number.isInteger(qty)
    ? String(qty)
    : String(Math.round(qty * 1000) / 1000);
  return unit ? `${text} ${unit}` : text;
}

// ── suppliers ──────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: SupplierStatus;
  statusReason: string | null;
  notes: string | null;
}

export interface SupplierInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  status?: SupplierStatus;
  statusReason?: string;
  notes?: string;
}

// ── categories & items ─────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  nameBn: string | null;
  description: string | null;
  itemCount: number;
  children: CategoryNode[];
}

export interface CategoryInput {
  name: string;
  nameBn?: string;
  parentId?: string;
  description?: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  type: ItemType;
  unit: ItemUnit;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  packSize: string | null;
  packLabel: string | null;
  reorderLevel: string | null;
  lastUnitCost: string | null;
  /** From the ledger — there is no quantity column on the item. */
  balance: number;
  balanceInPacks: number | null;
  belowReorder: boolean;
}

export interface ItemInput {
  code: string;
  name: string;
  nameBn?: string;
  type: ItemType;
  unit?: ItemUnit;
  categoryId?: string;
  description?: string;
  packSize?: number;
  packLabel?: string;
  reorderLevel?: number;
}

// ── purchases ──────────────────────────────────────────────────────────

export interface PurchaseLine {
  id: string;
  itemId: string;
  qty: string;
  packSize: string;
  baseQty: string;
  unitPrice: string;
  total: string;
  remarks: string | null;
  item: {
    id: string;
    code: string;
    name: string;
    unit: ItemUnit;
    type: ItemType;
    packSize: string | null;
    packLabel: string | null;
    categoryId: string | null;
  };
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  supplierId: string | null;
  supplier: { id: string; name: string; status: SupplierStatus } | null;
  date: string;
  invoiceRef: string | null;
  total: string;
  status: PurchaseStatus;
  remarks: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  voucherId: string | null;
  items: PurchaseLine[];
}

export interface PurchaseInput {
  supplierId?: string;
  date: string;
  invoiceRef?: string;
  remarks?: string;
  lines: Array<{
    itemId: string;
    qty: number;
    unitPrice: number;
    remarks?: string;
  }>;
}

export interface ReceiveInput {
  locationText?: string;
  custodianDeptId?: string;
  warrantyUntil?: string;
  condition?: AssetCondition;
}

// ── issues ─────────────────────────────────────────────────────────────

export interface Holder {
  type: HolderType;
  departmentId?: string;
  personType?: PersonType;
  personId?: string;
  room?: string;
}

export interface IssueLine {
  id: string;
  itemId: string;
  qty: string;
  returnedQty: string;
  remarks: string | null;
  item: { id: string; code: string; name: string; unit: ItemUnit };
}

export interface StockIssue {
  id: string;
  issueNo: string;
  issueDate: string;
  issuedToType: HolderType;
  issuedToDeptId: string | null;
  issuedToPersonId: string | null;
  issuedToRoom: string | null;
  /** Resolved live at read time — never stored on the slip. */
  holderName: string | null;
  purpose: string | null;
  status: IssueStatus;
  remarks: string | null;
  items: IssueLine[];
  outstanding: Array<{ issueItemId: string; outstanding: number }>;
}

export interface IssueInput {
  issueDate: string;
  issuedTo: Holder;
  purpose?: string;
  remarks?: string;
  lines: Array<{ itemId: string; qty: number; remarks?: string }>;
}

export interface LineRefusal {
  itemId: string;
  itemName: string;
  reason: string;
}

export interface IssuePreview {
  allowed: boolean;
  refusals: LineRefusal[];
  lines: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    available: number;
  }>;
}

export interface IssuableItem {
  id: string;
  code: string;
  name: string;
  unit: ItemUnit;
  packSize: number | null;
  packLabel: string | null;
  available: number;
}

// ── assets ─────────────────────────────────────────────────────────────

export interface Warranty {
  state: WarrantyState;
  until: string | null;
  daysLeft: number | null;
  message: string | null;
}

export interface AssetUnit {
  id: string;
  assetTag: string;
  serialNo: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  locationText: string | null;
  custodianType: HolderType | null;
  custodianName: string | null;
  purchasePrice: string | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  disposedAt: string | null;
  disposalReason: string | null;
  notes: string | null;
  warranty: Warranty;
  item: {
    id: string;
    code: string;
    name: string;
    category: { id: string; name: string } | null;
  };
}

export interface AssetInput {
  itemId: string;
  assetTag?: string;
  serialNo?: string;
  condition?: AssetCondition;
  locationText?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  warrantyUntil?: string;
  notes?: string;
}

// ── reports ────────────────────────────────────────────────────────────

export interface StockReportRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  categoryName: string | null;
  unit: string;
  type: ItemType;
  balance: number;
  reorderLevel: number | null;
  lastUnitCost: number | null;
  value: number | null;
  belowReorder: boolean;
}

export interface StockReport {
  rows: StockReportRow[];
  totalValue: number;
  unvaluedItems: number;
  itemsInStock: number;
  belowReorder: number;
  /** Printed beside the total: a valuation with no stated basis is read
   *  as FIFO by whoever opens it next. */
  valuationMethod: string;
  valuationNote: string;
}

export interface LedgerRow {
  id: string;
  txn: StockTxn;
  qtyIn: number;
  qtyOut: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  unitCost: number | null;
  remarks: string | null;
  createdAt: string;
}

export interface ItemLedgerReport {
  item: {
    id: string;
    code: string;
    name: string;
    unit: ItemUnit;
    type: ItemType;
    categoryName: string | null;
  };
  rows: LedgerRow[];
  balance: number;
  replayed: number;
  windowed: boolean;
}

export interface PurchaseSummaryReport {
  bySupplier: Array<{
    supplierId: string | null;
    supplierName: string;
    purchases: number;
    total: number;
  }>;
  byMonth: Array<{ month: string; purchases: number; total: number }>;
  purchaseList: Array<{
    id: string;
    purchaseNo: string;
    date: string;
    supplierName: string | null;
    invoiceRef: string | null;
    lines: number;
    total: number;
  }>;
  total: number;
  purchases: number;
}

export interface AssetRegisterReport {
  rows: Array<{
    id: string;
    assetTag: string;
    serialNo: string | null;
    itemName: string;
    itemCode: string;
    categoryName: string | null;
    status: AssetStatus;
    condition: AssetCondition;
    location: string | null;
    custodian: string;
    purchaseDate: string | null;
    purchasePrice: number | null;
    warranty: Warranty;
  }>;
  counts: {
    onBooks: number;
    disposed: number;
    lost: number;
    inStore: number;
    assigned: number;
    underRepair: number;
  };
  value: number;
  writtenOff: Array<{
    id: string;
    assetTag: string;
    itemName: string;
    status: AssetStatus;
    disposedAt: string | null;
    reason: string | null;
  }>;
}

export interface WarrantyReport {
  windowDays: number;
  rows: Array<{
    id: string;
    assetTag: string;
    itemName: string;
    status: AssetStatus | null;
    location: string | null;
    warrantyUntil: string | null;
    state: WarrantyState;
    daysLeft: number | null;
    message: string | null;
  }>;
}

export interface ConsumptionReport {
  groups: Array<{
    holderKey: string;
    holder: string;
    quantity: number;
    value: number;
    items: Array<{
      itemId: string;
      itemName: string;
      quantity: number;
      value: number;
    }>;
  }>;
  total: number;
}

export interface LowStockReport {
  rows: Array<
    StockReportRow & {
      shortfall: number;
    }
  >;
}

export interface HolderOptions {
  departments: Array<{ id: string; name: string; code: string }>;
  people: Array<{
    personType: PersonType;
    personId: string;
    name: string;
    reference: string;
    designation: string | null;
  }>;
}

// ── the client ─────────────────────────────────────────────────────────

export const inventoryApi = {
  // suppliers
  listSuppliers: (
    query: { page?: number; limit?: number; search?: string; status?: SupplierStatus } = {},
  ) => paginated<Supplier>("/inventory/suppliers", query),
  createSupplier: (body: SupplierInput) =>
    api
      .post<ApiEnvelope<Supplier>>("/inventory/suppliers", body)
      .then((r) => r.data.data),
  updateSupplier: (id: string, body: SupplierInput) =>
    api
      .patch<ApiEnvelope<Supplier>>(`/inventory/suppliers/${id}`, body)
      .then((r) => r.data.data),
  deleteSupplier: (id: string) => api.delete(`/inventory/suppliers/${id}`),

  // categories
  categoryTree: () => unwrap<CategoryNode[]>("/inventory/categories"),
  createCategory: (body: CategoryInput) =>
    api
      .post<ApiEnvelope<CategoryNode>>("/inventory/categories", body)
      .then((r) => r.data.data),
  updateCategory: (id: string, body: CategoryInput) =>
    api
      .patch<ApiEnvelope<CategoryNode>>(`/inventory/categories/${id}`, body)
      .then((r) => r.data.data),
  deleteCategory: (id: string) => api.delete(`/inventory/categories/${id}`),

  // items
  listItems: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      type?: ItemType;
      categoryId?: string;
      lowStock?: boolean;
    } = {},
  ) => paginated<Item>("/inventory/items", query),
  getItem: (id: string) => unwrap<Item>(`/inventory/items/${id}`),
  createItem: (body: ItemInput) =>
    api.post<ApiEnvelope<Item>>("/inventory/items", body).then((r) => r.data.data),
  updateItem: (id: string, body: ItemInput) =>
    api
      .patch<ApiEnvelope<Item>>(`/inventory/items/${id}`, body)
      .then((r) => r.data.data),
  deleteItem: (id: string) => api.delete(`/inventory/items/${id}`),
  itemHistory: (id: string) => unwrap<LedgerRow[]>(`/inventory/items/${id}/ledger`),

  // purchases
  listPurchases: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: PurchaseStatus;
      supplierId?: string;
      from?: string;
      to?: string;
    } = {},
  ) => paginated<Purchase>("/inventory/purchases", query),
  getPurchase: (id: string) => unwrap<Purchase>(`/inventory/purchases/${id}`),
  createPurchase: (body: PurchaseInput) =>
    api
      .post<ApiEnvelope<Purchase>>("/inventory/purchases", body)
      .then((r) => r.data.data),
  updatePurchase: (id: string, body: PurchaseInput) =>
    api
      .patch<ApiEnvelope<Purchase>>(`/inventory/purchases/${id}`, body)
      .then((r) => r.data.data),
  deletePurchase: (id: string) => api.delete(`/inventory/purchases/${id}`),
  receivePurchase: (id: string, body: ReceiveInput = {}) =>
    api
      .post<
        ApiEnvelope<{
          purchase: Purchase;
          assetUnitsGenerated: number;
          voucherId: string | null;
        }>
      >(`/inventory/purchases/${id}/receive`, body)
      .then((r) => r.data.data),
  cancelPurchase: (id: string, reason: string) =>
    api
      .post<
        ApiEnvelope<{
          purchase: Purchase;
          stockReversed: boolean;
          voucherStanding: string | null;
        }>
      >(`/inventory/purchases/${id}/cancel`, { reason })
      .then((r) => r.data.data),

  // issues
  listIssues: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: IssueStatus;
      issuedToType?: HolderType;
      departmentId?: string;
      from?: string;
      to?: string;
    } = {},
  ) => paginated<StockIssue>("/inventory/issues", query),
  getIssue: (id: string) => unwrap<StockIssue>(`/inventory/issues/${id}`),
  previewIssue: (body: IssueInput) =>
    api
      .post<ApiEnvelope<IssuePreview>>("/inventory/issues/preview", body)
      .then((r) => r.data.data),
  createIssue: (body: IssueInput) =>
    api
      .post<ApiEnvelope<StockIssue>>("/inventory/issues", body)
      .then((r) => r.data.data),
  returnIssue: (
    id: string,
    body: { lines: Array<{ issueItemId: string; qty: number }>; remarks?: string },
  ) =>
    api
      .post<ApiEnvelope<StockIssue>>(`/inventory/issues/${id}/return`, body)
      .then((r) => r.data.data),
  issuableItems: (search?: string) =>
    unwrap<IssuableItem[]>("/inventory/issuable-items", { search }),

  // adjustments
  adjust: (body: {
    lines: Array<{ itemId: string; countedQty: number }>;
    reason: string;
  }) =>
    api
      .post<
        ApiEnvelope<{
          adjusted: Array<{
            itemId: string;
            itemName: string;
            expected: number;
            counted: number;
            difference: number;
            direction: "IN" | "OUT";
          }>;
          message: string | null;
        }>
      >("/inventory/adjustments", body)
      .then((r) => r.data.data),

  // assets
  listAssets: (
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: AssetStatus;
      itemId?: string;
      categoryId?: string;
      custodianType?: HolderType;
      departmentId?: string;
      personId?: string;
      onBooksOnly?: boolean;
    } = {},
  ) => paginated<AssetUnit>("/inventory/assets", query),
  getAsset: (id: string) => unwrap<AssetUnit>(`/inventory/assets/${id}`),
  createAsset: (body: AssetInput) =>
    api
      .post<ApiEnvelope<AssetUnit>>("/inventory/assets", body)
      .then((r) => r.data.data),
  updateAsset: (id: string, body: AssetInput) =>
    api
      .patch<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}`, body)
      .then((r) => r.data.data),
  assignAsset: (
    id: string,
    body: { custodian: Holder; locationText?: string; remarks?: string },
  ) =>
    api
      .post<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}/assign`, body)
      .then((r) => r.data.data),
  returnAsset: (id: string) =>
    api
      .post<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}/return`, {})
      .then((r) => r.data.data),
  repairAsset: (id: string, body: { remarks?: string; condition?: AssetCondition }) =>
    api
      .post<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}/repair`, body)
      .then((r) => r.data.data),
  completeRepair: (
    id: string,
    body: { remarks?: string; condition?: AssetCondition; returnTo?: Holder },
  ) =>
    api
      .post<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}/repair-complete`, body)
      .then((r) => r.data.data),
  disposeAsset: (
    id: string,
    body: { status: "DISPOSED" | "LOST"; disposedAt: string; reason: string },
  ) =>
    api
      .post<ApiEnvelope<AssetUnit>>(`/inventory/assets/${id}/dispose`, body)
      .then((r) => r.data.data),

  // pickers
  holders: (search?: string) =>
    unwrap<HolderOptions>("/inventory/holders", { search }),
};

export const inventoryReportsApi = {
  stock: (query: { categoryId?: string; type?: ItemType } = {}) =>
    unwrap<StockReport>("/inventory/reports/stock", query),
  lowStock: () => unwrap<LowStockReport>("/inventory/reports/low-stock"),
  itemLedger: (itemId: string, query: { from?: string; to?: string } = {}) =>
    unwrap<ItemLedgerReport>(`/inventory/reports/ledger/${itemId}`, query),
  purchases: (query: { from?: string; to?: string; supplierId?: string } = {}) =>
    unwrap<PurchaseSummaryReport>("/inventory/reports/purchases", query),
  assets: (query: { categoryId?: string } = {}) =>
    unwrap<AssetRegisterReport>("/inventory/reports/assets", query),
  warranty: (days?: number) =>
    unwrap<WarrantyReport>("/inventory/reports/warranty", { days }),
  consumption: (query: { from?: string; to?: string } = {}) =>
    unwrap<ConsumptionReport>("/inventory/reports/consumption", query),

  downloadStock: () =>
    downloadFile("/inventory/reports/stock/export", "stock-valuation.xlsx"),
  downloadItemLedger: (itemId: string) =>
    downloadFile(
      `/inventory/reports/ledger/${itemId}/export`,
      "item-ledger.xlsx",
    ),
  downloadPurchases: (query: { from?: string; to?: string } = {}) => {
    const search = new URLSearchParams(
      params(query) as Record<string, string>,
    ).toString();
    return downloadFile(
      `/inventory/reports/purchases/export${search ? `?${search}` : ""}`,
      "purchases.xlsx",
    );
  },
  downloadAssets: () =>
    downloadFile("/inventory/reports/assets/export", "asset-register.xlsx"),
  /** The sheet somebody carries around a building with a pen. */
  downloadAssetsPdf: () =>
    downloadFile("/inventory/reports/assets/export/pdf", "asset-register.pdf"),
  downloadWarranty: () =>
    downloadFile(
      "/inventory/reports/warranty/export",
      "warranties-expiring.xlsx",
    ),
  downloadConsumption: (query: { from?: string; to?: string } = {}) => {
    const search = new URLSearchParams(
      params(query) as Record<string, string>,
    ).toString();
    return downloadFile(
      `/inventory/reports/consumption/export${search ? `?${search}` : ""}`,
      "consumption.xlsx",
    );
  },
};
