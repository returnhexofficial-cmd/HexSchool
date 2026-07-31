import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface BilledTransport {
  enrollmentId: string;
  /** Net of discount — what the family was asked for. */
  invoiced: number;
  /** The transport share of what has actually been paid — see below. */
  collected: number;
}

/**
 * The one thing this module needs to read out of M16: how much transport
 * money was billed, and how much of it came in.
 *
 * It is a **narrow query over PrismaService rather than an import of
 * FeeModule** — the M12 `EmployeeDirectoryRepository` / M17
 * `AudienceRepository` / M18 `DashboardRepository` / M19
 * `PublicSiteRepository` / M22 policy-query / M23
 * `LibraryDirectoryRepository` precedent. FeeModule exports the ledger
 * and the invoice reads, but neither answers "per fee head, per route",
 * and importing a whole module for one aggregate would overstate the
 * dependency — TransportModule needs *the numbers*, not fee management.
 *
 * **The honest caveat, stated where the arithmetic is:** money is
 * collected against an INVOICE, never against a line. A family paying
 * ৳3,000 of a ৳5,000 bill has not told anybody which part of it was the
 * bus. So the transport share of a payment is attributed **pro rata** to
 * the transport share of the invoice, which is the standard treatment and
 * is exact whenever an invoice is fully paid or fully unpaid — the two
 * cases that cover almost every row.
 */
@Injectable()
export class TransportBillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async billedForMonth(
    schoolId: string,
    feeHeadId: string,
    /** First day of the billing month. */
    billingMonth: Date,
  ): Promise<Map<string, BilledTransport>> {
    const rows = await this.prisma.invoiceItem.findMany({
      where: {
        schoolId,
        feeHeadId,
        invoice: {
          is: {
            schoolId,
            billingMonth,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
        },
      },
      select: {
        amount: true,
        discount: true,
        invoice: {
          select: { enrollmentId: true, payable: true, paidTotal: true },
        },
      },
    });

    const out = new Map<string, BilledTransport>();
    for (const row of rows) {
      const net = Number(row.amount) - Number(row.discount);
      const payable = Number(row.invoice.payable);
      const paid = Number(row.invoice.paidTotal);
      // A zero-payable invoice is fully settled by definition (M16's
      // `deriveStatus`), so the ratio is 1 rather than a division by zero.
      const ratio = payable <= 0 ? 1 : Math.min(1, paid / payable);

      const existing = out.get(row.invoice.enrollmentId) ?? {
        enrollmentId: row.invoice.enrollmentId,
        invoiced: 0,
        collected: 0,
      };
      existing.invoiced = round(existing.invoiced + net);
      existing.collected = round(existing.collected + net * ratio);
      out.set(row.invoice.enrollmentId, existing);
    }
    return out;
  }

  /** Live fee heads, so the settings UI can offer a Transport head. */
  async feeHeads(
    schoolId: string,
  ): Promise<Array<{ id: string; name: string; type: string }>> {
    const rows = await this.prisma.feeHead.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true, type: true },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((row) => ({ ...row, type: String(row.type) }));
  }

  /**
   * Resolve the transport fee head: the configured id first, then a live
   * head whose name matches — the M20 posting-map fallback shape, so a
   * school that simply created a head called "Transport" bills correctly
   * with nothing configured.
   */
  async resolveFeeHead(
    schoolId: string,
    configuredId: string,
    fallbackName: string,
  ): Promise<{ id: string; name: string } | null> {
    if (configuredId) {
      const byId = await this.prisma.feeHead.findFirst({
        where: { id: configuredId, schoolId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (byId) return byId;
    }
    return this.prisma.feeHead.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: fallbackName, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
