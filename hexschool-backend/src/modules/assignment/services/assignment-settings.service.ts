import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';
import type { AttachmentLimits } from '../calc/attachment.util';

export interface AssignmentConfig {
  enabled: boolean;
  limits: AttachmentLimits;
  allowResubmission: boolean;
  resubmissionUntilDue: boolean;
  allowLateDefault: boolean;
  defaultDueDays: number;
  publishNotification: boolean;
  notificationChannel: NotificationChannel;
  dueReminderEnabled: boolean;
  dueReminderHours: number;
  noSubmissionAlertDays: number;
  materialLinkHosts: string[];
}

const DEFAULT_TYPES = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
const DEFAULT_HOSTS = [
  'youtube.com',
  'youtu.be',
  'drive.google.com',
  'docs.google.com',
];

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** A JSON setting that should be a string array, however it was edited. */
function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * One typed read of the whole `assignment.*` group — the M12/M13/M19/M20/
 * M21 settings-service precedent, so no service reaches into
 * `SettingsService` key by key and no engine has to remember a default.
 *
 * Every malformed value falls back to the registry default rather than
 * throwing: a hand-edited `allowed_file_types` must not be able to take
 * the submit endpoint down on the evening a class is handing work in.
 *
 * The one deliberate asymmetry is `material_link_hosts`, where an
 * explicitly **empty** list means "any https host" — see
 * `linkIssues` — so it is read through `Array.isArray` rather than
 * `stringList`, which would substitute the default and quietly re-impose
 * a restriction the school removed.
 */
@Injectable()
export class AssignmentSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<AssignmentConfig> {
    const [
      enabled,
      maxAttachments,
      maxAttachmentMb,
      allowedFileTypes,
      allowResubmission,
      resubmissionUntilDue,
      allowLateDefault,
      defaultDueDays,
      publishNotification,
      notificationChannel,
      dueReminderEnabled,
      dueReminderHours,
      noSubmissionAlertDays,
      materialLinkHosts,
    ] = await Promise.all([
      this.settings.getValue<boolean>(schoolId, 'assignment.enabled'),
      this.settings.getValue<number>(schoolId, 'assignment.max_attachments'),
      this.settings.getValue<number>(schoolId, 'assignment.max_attachment_mb'),
      this.settings.getValue<unknown>(
        schoolId,
        'assignment.allowed_file_types',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'assignment.allow_resubmission',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'assignment.resubmission_until_due',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'assignment.allow_late_default',
      ),
      this.settings.getValue<number>(schoolId, 'assignment.default_due_days'),
      this.settings.getValue<boolean>(
        schoolId,
        'assignment.publish_notification',
      ),
      this.settings.getValue<string>(
        schoolId,
        'assignment.notification_channel',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'assignment.due_reminder_enabled',
      ),
      this.settings.getValue<number>(schoolId, 'assignment.due_reminder_hours'),
      this.settings.getValue<number>(
        schoolId,
        'assignment.no_submission_alert_days',
      ),
      this.settings.getValue<unknown>(
        schoolId,
        'assignment.material_link_hosts',
      ),
    ]);

    return {
      enabled: enabled !== false,
      limits: {
        maxCount: clamp(maxAttachments, 1, 20, 3),
        maxBytes: clamp(maxAttachmentMb, 1, 100, 10) * 1024 * 1024,
        allowedTypes: stringList(allowedFileTypes, DEFAULT_TYPES),
      },
      allowResubmission: allowResubmission !== false,
      resubmissionUntilDue: resubmissionUntilDue !== false,
      allowLateDefault: allowLateDefault === true,
      defaultDueDays: clamp(defaultDueDays, 1, 365, 7),
      publishNotification: publishNotification !== false,
      // Only SMS opts out of the free default; anything else is IN_APP.
      notificationChannel:
        String(notificationChannel ?? '').toUpperCase() === 'SMS'
          ? NotificationChannel.SMS
          : NotificationChannel.IN_APP,
      dueReminderEnabled: dueReminderEnabled !== false,
      dueReminderHours: clamp(dueReminderHours, 1, 168, 24),
      noSubmissionAlertDays: clamp(noSubmissionAlertDays, 1, 60, 3),
      materialLinkHosts: Array.isArray(materialLinkHosts)
        ? materialLinkHosts.filter((v): v is string => typeof v === 'string')
        : DEFAULT_HOSTS,
    };
  }
}
