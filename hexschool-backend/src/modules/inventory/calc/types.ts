/**
 * The enum values the inventory engines reason about, as plain string
 * literal unions.
 *
 * **Why these are not the Prisma enums.** Every `calc/` engine in this
 * codebase is dependency-free — M16's `money.util`, M20's
 * `voucher.engine`, M23's `circulation.engine`, M25's `capacity.engine`
 * import nothing from `@prisma/client`, and that is what makes them
 * cheap to golden-test and importable from any module. Reaching for
 * `common/constants` here would have pulled the whole generated client
 * into every engine and every spec file; it did, and Jest's workers ran
 * out of memory proving it.
 *
 * The generated Prisma enums are string enums, so their values are
 * assignable to these unions and vice versa — a service passes
 * `item.unit` straight in, and `tsc` checks that the two lists agree. If
 * a future migration adds a value to a PG enum without adding it here,
 * the mismatch surfaces at the call site rather than silently at run
 * time.
 */

/** Mirrors `item_type_enum`. */
export type ItemKind = 'ASSET' | 'CONSUMABLE';

/** Mirrors `item_unit_enum`. */
export type StockUnit =
  'PCS' | 'BOX' | 'REAM' | 'SET' | 'LITER' | 'KG' | 'OTHER';

/** Mirrors `stock_txn_enum`. */
export type StockTxn = 'PURCHASE' | 'ISSUE' | 'RETURN' | 'ADJUST' | 'DISPOSE';

/** Mirrors `asset_unit_status_enum`. */
export type AssetStatus =
  'IN_STORE' | 'ASSIGNED' | 'UNDER_REPAIR' | 'DISPOSED' | 'LOST';

/** Mirrors `stock_issue_status_enum`. */
export type IssueStatus = 'ISSUED' | 'PARTIAL_RETURN' | 'RETURNED';
