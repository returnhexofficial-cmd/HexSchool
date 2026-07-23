import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvoiceStatus } from '../../../common/constants';
import { isoDate } from '../../academic/calendar/date.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { assessFine, deriveStatus } from '../calc/fine.engine';
import { money } from '../calc/money.util';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { FeeSettingsService } from '../services/fee-settings.service';

/**
 * Nightly late-fine run (roadmap M16 §4).
 *
 * **Idempotent per month, which is the whole design.** The job runs every
 * night, but `invoices.fined_for_month` records the month last charged,
 * so an invoice left unpaid for three weeks is fined once, not
 * twenty-one times. The decision lives in `fine.engine.ts` and is
 * golden-tested; this class only supplies the rows and records the
 * outcome.
 *
 * Adding a fine changes `payable`, so `paid_total` may now be short of
 * it — the status is recomputed through the same `deriveStatus` every
 * other money path uses.
 */
@Injectable()
export class FineJob {
  private readonly logger = new Logger(FineJob.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: FeeSettingsService,
  ) {}

  /** 01:30 nightly — after the day's collection has settled. */
  @Cron('30 1 * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id);
    }
    return total;
  }

  /** Exposed for tests and a manual "apply fines now" action. */
  async runForSchool(schoolId: string): Promise<number> {
    const config = await this.config.load(schoolId);
    if (config.fine.flatPerMonth <= 0 && config.fine.percentPerMonth <= 0) {
      return 0;
    }

    const today = new Date();
    const todayIso = isoDate(today);
    const currentMonth = `${todayIso.slice(0, 7)}-01`;

    const candidates = await this.invoices.findFinable(schoolId, today);
    let charged = 0;

    for (const invoice of candidates) {
      const payable = Number(invoice.payable);
      const verdict = assessFine(
        {
          payable,
          fineSoFar: Number(invoice.fineTotal),
          dueDate: isoDate(invoice.dueDate),
          today: todayIso,
          finedForMonth: invoice.finedForMonth
            ? isoDate(invoice.finedForMonth)
            : null,
          currentMonth,
        },
        config.fine,
      );

      if (verdict.charge <= 0) continue;

      const fineTotal = money(Number(invoice.fineTotal) + verdict.charge);
      // `payable` is pinned by chk_invoices_payable, so it moves with
      // the fine — the CHECK would refuse the write otherwise.
      const newPayable = money(
        Number(invoice.subtotal) - Number(invoice.discountTotal) + fineTotal,
      );

      const status = deriveStatus({
        payable: newPayable,
        paidTotal: Number(invoice.paidTotal),
        dueDate: isoDate(invoice.dueDate),
        today: todayIso,
        cancelled: invoice.status === InvoiceStatus.CANCELLED,
        fullyRefunded: false,
      });

      await this.invoices.update(invoice.id, {
        fineTotal,
        payable: newPayable,
        finedForMonth: new Date(currentMonth),
        status,
      });
      charged += 1;
    }

    if (charged > 0) {
      this.logger.log(`Late fines applied to ${charged} invoice(s)`);
    }
    return charged;
  }
}
