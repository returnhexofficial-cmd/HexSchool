import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import {
  NotificationService,
  type SendNotificationInput,
} from '../../communication/services/notification.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import type { StockUnit } from '../calc/types';
import { formatQty } from '../calc/unit.util';
import { InventoryDirectoryRepository } from '../repositories/inventory-directory.repository';
import { AssetsService } from './assets.service';
import { InventoryReportsService } from './inventory-reports.service';
import { InventorySettingsService } from './inventory-settings.service';

/**
 * Roadmap §4's "low-stock alert job (reorder_level) → admin notification",
 * plus the warranty chase the asset register needs for the same reason.
 *
 * Both go through M17's `NotificationService.send()` — the single entry
 * point, no direct gateway calls (PROJECT_CONTEXT §11).
 *
 * **One message per school, not one per item.** A store with forty items
 * below reorder level would otherwise produce forty bells, and the office
 * would stop reading them by Wednesday. The message names the worst few
 * and gives a count, which is what makes it actionable — the M17
 * sibling-merge reasoning, applied to items instead of children.
 */
@Injectable()
export class InventoryNotificationsService {
  private readonly logger = new Logger(InventoryNotificationsService.name);

  /** How many items to name before the message says "and N more". */
  private static readonly NAMED = 5;

  constructor(
    private readonly notifications: NotificationService,
    private readonly reports: InventoryReportsService,
    private readonly assets: AssetsService,
    private readonly directory: InventoryDirectoryRepository,
    private readonly config: InventorySettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async sendLowStockAlert(schoolId: string): Promise<number> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.lowStockAlertEnabled) return 0;

    const { rows } = await this.reports.lowStock(schoolId);
    if (rows.length === 0) return 0;

    const recipients = await this.directory.adminUserIds(schoolId);
    if (recipients.length === 0) {
      this.logger.warn(
        `Low stock in ${rows.length} item(s) but no admin/office user to tell.`,
      );
      return 0;
    }

    const named = rows
      .slice(0, InventoryNotificationsService.NAMED)
      .map(
        (row) =>
          `${row.itemName} (${formatQty(row.balance, row.unit as StockUnit)})`,
      )
      .join(', ');
    const extra = rows.length - InventoryNotificationsService.NAMED;

    let sent = 0;
    for (const userId of recipients) {
      const ok = await this.safeSend({
        schoolId,
        code: 'INVENTORY_LOW_STOCK',
        channel: cfg.lowStockAlertChannel,
        recipient: {
          type: NotificationRecipientType.USER,
          id: userId,
          destination:
            cfg.lowStockAlertChannel === NotificationChannel.SMS
              ? await this.userPhone(userId)
              : null,
        },
        vars: {
          count: String(rows.length),
          items: extra > 0 ? `${named} and ${extra} more` : named,
        },
        dedupe: true,
      });
      if (ok) sent++;
    }
    return sent;
  }

  async sendWarrantyAlert(schoolId: string): Promise<number> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.lowStockAlertEnabled) return 0;

    const rows = await this.assets.warrantyAlerts(schoolId);
    // Only the ones that have actually lapsed or are about to. An asset
    // with no warranty date recorded stays in the REPORT (it is the one
    // most likely to be out of cover — the M25 rule) but does not earn a
    // weekly bell, because nothing about it changes week to week.
    const actionable = rows.filter(
      (row) =>
        row.warranty.state === 'EXPIRED' || row.warranty.state === 'EXPIRING',
    );
    if (actionable.length === 0) return 0;

    const recipients = await this.directory.adminUserIds(schoolId);
    if (recipients.length === 0) return 0;

    const named = actionable
      .slice(0, InventoryNotificationsService.NAMED)
      .map((row) => `${row.assetTag} ${row.itemName}`)
      .join(', ');
    const extra = actionable.length - InventoryNotificationsService.NAMED;

    let sent = 0;
    for (const userId of recipients) {
      const ok = await this.safeSend({
        schoolId,
        code: 'INVENTORY_WARRANTY_EXPIRING',
        channel: cfg.lowStockAlertChannel,
        recipient: {
          type: NotificationRecipientType.USER,
          id: userId,
          destination:
            cfg.lowStockAlertChannel === NotificationChannel.SMS
              ? await this.userPhone(userId)
              : null,
        },
        vars: {
          count: String(actionable.length),
          assets: extra > 0 ? `${named} and ${extra} more` : named,
        },
        dedupe: true,
      });
      if (ok) sent++;
    }
    return sent;
  }

  /**
   * The M20/M25 rule one level up: an alert that cannot be sent must not
   * take the nightly sweep — or a purchase screen — down with it. The
   * store is still short, and the report says so whether or not the bell
   * rang.
   */
  private async safeSend(input: SendNotificationInput): Promise<boolean> {
    try {
      await this.notifications.send(input);
      return true;
    } catch (error) {
      this.logger.error(
        `${input.code} to ${input.recipient.id ?? 'unknown'} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async userPhone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    return user?.phone ?? null;
  }
}
