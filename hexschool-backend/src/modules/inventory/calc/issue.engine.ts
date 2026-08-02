/**
 * The issue desk (roadmap M24 §4 "issue/return for consumables", §6
 * "issue qty ≤ available; consumable returns ≤ issued").
 *
 * Dependency-free and golden-tested. Two things live here:
 *
 *  - **One verdict per question.** `canIssue` answers "may this go out"
 *    and `canReturn` answers "may this come back", and both are called by
 *    the preview, by the endpoint and by the UI's disabled state — so the
 *    greyed button, the 409 body and the warning line are three
 *    renderings of one object. The M16 `deriveStatus` / M23 `canIssue` /
 *    M25 `capacityVerdict` rule, fourth use.
 *  - **The slip's status is derived.** `deriveIssueStatus` computes
 *    ISSUED / PARTIAL_RETURN / RETURNED from the lines, and the service
 *    stores what it returns. Nothing may assign one by hand — a status a
 *    write path chooses is a status that eventually disagrees with the
 *    rows beneath it (the M16 invoice rule, and M23's `fine_paid` pinned
 *    at the database for the same reason).
 */

import type { IssueStatus, ItemKind, StockUnit } from './types';
import { qty, validateQty } from './unit.util';

export interface IssueLineRequest {
  itemId: string;
  /** In BASE units — the conversion happened before this point. */
  quantity: number;
}

export interface IssueLineContext {
  itemId: string;
  itemName: string;
  itemCode: string;
  type: ItemKind;
  unit: StockUnit;
  /** Current ledger balance in base units. */
  available: number;
}

export interface LineRefusal {
  itemId: string;
  itemName: string;
  reason: string;
}

export interface IssueVerdict {
  allowed: boolean;
  /** Every bad line, not just the first — see below. */
  refusals: LineRefusal[];
  /** The lines that would go out, normalized. */
  lines: Array<{ itemId: string; quantity: number }>;
}

/**
 * May this whole slip go out?
 *
 * **All-or-nothing, and every bad line is reported at once** — the M22
 * bulk-evaluation-grid rule. A store keeper filling a six-item slip
 * should be told about all three problems in one go rather than
 * discovering them one save at a time, and the slip is refused as a unit
 * because half a gate pass is not a document anybody can sign.
 *
 * **An ASSET is refused outright.** An asset does not leave the store by
 * being issued in a quantity — it is *assigned*, one tagged unit at a
 * time, through the asset register, and letting a clerk "issue 3
 * projectors" here would create a stock movement that no tag, location or
 * custodian corresponds to. That is a structural refusal: no permission
 * reaches it (the M13/M14/M23 structural-vs-policy split).
 */
export function canIssue(
  requested: IssueLineRequest[],
  context: Map<string, IssueLineContext>,
): IssueVerdict {
  const refusals: LineRefusal[] = [];
  const lines: Array<{ itemId: string; quantity: number }> = [];

  if (requested.length === 0) {
    return {
      allowed: false,
      refusals: [
        {
          itemId: '',
          itemName: '',
          reason: 'An issue needs at least one item.',
        },
      ],
      lines: [],
    };
  }

  const seen = new Set<string>();
  for (const line of requested) {
    const item = context.get(line.itemId);
    if (!item) {
      refusals.push({
        itemId: line.itemId,
        itemName: '',
        reason: 'That item is not in the catalogue.',
      });
      continue;
    }

    // The identity index refuses this at the database too; catching it
    // here is what lets the message name the item rather than surfacing a
    // constraint name to a clerk.
    if (seen.has(line.itemId)) {
      refusals.push({
        itemId: item.itemId,
        itemName: item.itemName,
        reason: 'Listed twice on the same slip — combine the quantities.',
      });
      continue;
    }
    seen.add(line.itemId);

    if (item.type === 'ASSET') {
      refusals.push({
        itemId: item.itemId,
        itemName: item.itemName,
        reason:
          'This is an asset — assign a tagged unit from the asset register instead of issuing a quantity.',
      });
      continue;
    }

    const validated = validateQty(line.quantity, item.unit);
    if (!validated.ok) {
      refusals.push({
        itemId: item.itemId,
        itemName: item.itemName,
        reason: validated.reason,
      });
      continue;
    }

    if (validated.qty > qty(item.available)) {
      refusals.push({
        itemId: item.itemId,
        itemName: item.itemName,
        reason: `Only ${qty(item.available)} ${item.unit} on hand — ${validated.qty} cannot be issued.`,
      });
      continue;
    }

    lines.push({ itemId: item.itemId, quantity: validated.qty });
  }

  return { allowed: refusals.length === 0, refusals, lines };
}

export interface ReturnLineRequest {
  /** The `stock_issue_items` row, not the item — a slip may not list an
   *  item twice, but a return has to name the line it credits. */
  issueItemId: string;
  quantity: number;
}

export interface ReturnLineContext {
  issueItemId: string;
  itemId: string;
  itemName: string;
  unit: StockUnit;
  issued: number;
  returned: number;
}

export interface ReturnVerdict {
  allowed: boolean;
  refusals: LineRefusal[];
  lines: Array<{ issueItemId: string; itemId: string; quantity: number }>;
}

/**
 * May this come back?
 *
 * The ceiling is `issued − already returned`, per line. Roadmap §6 says
 * "consumable returns ≤ issued", and the reason it is a hard rule rather
 * than a warning is that the excess would be stock the school never
 * bought: the ledger would balance perfectly and the store would be
 * short, which is the M20 lesson about errors that are invisible because
 * both sides still add up.
 */
export function canReturn(
  requested: ReturnLineRequest[],
  context: Map<string, ReturnLineContext>,
): ReturnVerdict {
  const refusals: LineRefusal[] = [];
  const lines: Array<{
    issueItemId: string;
    itemId: string;
    quantity: number;
  }> = [];

  if (requested.length === 0) {
    return {
      allowed: false,
      refusals: [
        {
          itemId: '',
          itemName: '',
          reason: 'A return needs at least one line.',
        },
      ],
      lines: [],
    };
  }

  const seen = new Set<string>();
  for (const line of requested) {
    const row = context.get(line.issueItemId);
    if (!row) {
      refusals.push({
        itemId: '',
        itemName: '',
        reason: 'That line is not on this issue slip.',
      });
      continue;
    }
    if (seen.has(line.issueItemId)) {
      refusals.push({
        itemId: row.itemId,
        itemName: row.itemName,
        reason: 'Listed twice in the same return — combine the quantities.',
      });
      continue;
    }
    seen.add(line.issueItemId);

    const validated = validateQty(line.quantity, row.unit);
    if (!validated.ok) {
      refusals.push({
        itemId: row.itemId,
        itemName: row.itemName,
        reason: validated.reason,
      });
      continue;
    }

    const outstanding = qty(row.issued - row.returned);
    if (validated.qty > outstanding) {
      refusals.push({
        itemId: row.itemId,
        itemName: row.itemName,
        reason:
          outstanding <= 0
            ? 'Everything issued on this line has already come back.'
            : `Only ${outstanding} ${row.unit} of that line is still out.`,
      });
      continue;
    }

    lines.push({
      issueItemId: row.issueItemId,
      itemId: row.itemId,
      quantity: validated.qty,
    });
  }

  return { allowed: refusals.length === 0, refusals, lines };
}

export interface IssueStatusLine {
  qty: number;
  returnedQty: number;
}

/**
 * The slip's status, computed from its lines — never assigned.
 *
 * RETURNED requires **every** line to be fully back, which is why the
 * predicate is a fold rather than a count: a slip with four lines, three
 * complete and one short by a single pen, is PARTIAL_RETURN, and a school
 * chasing outstanding stores needs it to say so.
 */
export function deriveIssueStatus(lines: IssueStatusLine[]): IssueStatus {
  if (lines.length === 0) return 'ISSUED';

  let anyReturned = false;
  let allReturned = true;

  for (const line of lines) {
    const issued = qty(line.qty);
    const returned = qty(line.returnedQty);
    if (returned > 0) anyReturned = true;
    if (returned < issued) allReturned = false;
  }

  if (allReturned) return 'RETURNED';
  return anyReturned ? 'PARTIAL_RETURN' : 'ISSUED';
}

/** What is still out on a slip, per line — the return form's defaults. */
export function outstandingLines(
  lines: Array<IssueStatusLine & { issueItemId: string }>,
): Array<{ issueItemId: string; outstanding: number }> {
  return lines
    .map((line) => ({
      issueItemId: line.issueItemId,
      outstanding: qty(line.qty - line.returnedQty),
    }))
    .filter((line) => line.outstanding > 0);
}
