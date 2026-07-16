import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettingsGroup } from '../../../common/constants';
import { RedisCacheService } from '../../../database/redis/redis-cache.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolSettingsRepository } from '../repositories/school-settings.repository';
import {
  groupDefinitions,
  SECRET_MASK,
  SettingDefinition,
  settingDefinition,
} from '../settings/settings.registry';
import { SettingsCryptoService } from './settings-crypto.service';

const CACHE_TTL_SECONDS = 60; // safety net; every write busts explicitly
const cacheKey = (schoolId: string, group: SettingsGroup) =>
  `settings:${schoolId}:${group}`;

/** GET /settings/:group entry: definition metadata + display value. */
export interface SettingView {
  key: string;
  label: string;
  type: SettingDefinition['type'];
  secret: boolean;
  /** Secrets: SECRET_MASK when set, '' when never configured. */
  value: unknown;
}

/**
 * The generic settings service every later module consumes via DI
 * (roadmap M04): registry-validated writes, AES-256-GCM secrets at
 * rest, Redis-cached reads (60 s TTL + bust-on-write), typed getters
 * with registry defaults.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly settings: SchoolSettingsRepository,
    private readonly crypto: SettingsCryptoService,
    private readonly cache: RedisCacheService,
    private readonly auditContext: AuditContextService,
  ) {}

  /**
   * Typed getter for internal consumers (attendance, fees, gateways…).
   * Secrets come back decrypted — this path never crosses the API.
   */
  async getValue<T>(schoolId: string, key: string): Promise<T> {
    const def = settingDefinition(key);
    if (!def) throw new Error(`Unknown setting key "${key}"`);

    const raw = await this.rawGroupValues(schoolId, def.group);
    if (!(key in raw)) return def.default as T;
    const stored = raw[key];
    if (def.secret && typeof stored === 'string' && stored !== '') {
      try {
        return this.crypto.decrypt(stored) as T;
      } catch {
        // Tampered/rotated-key rows fail closed to the default.
        this.logger.error(`decrypt failed for ${key} — returning default`);
        return def.default as T;
      }
    }
    return stored as T;
  }

  /** API shape: every registry key with defaults merged, secrets masked. */
  async getGroup(
    schoolId: string,
    group: SettingsGroup,
  ): Promise<SettingView[]> {
    const raw = await this.rawGroupValues(schoolId, group);
    return groupDefinitions(group).map((def) => {
      const stored = raw[def.key];
      let value: unknown = stored === undefined ? def.default : stored;
      if (def.secret) {
        value = typeof stored === 'string' && stored !== '' ? SECRET_MASK : '';
      }
      return {
        key: def.key,
        label: def.label,
        type: def.type,
        secret: def.secret ?? false,
        value,
      };
    });
  }

  /**
   * Registry-validated partial update: unknown keys and type mismatches
   * are rejected; secrets are encrypted; the SECRET_MASK sentinel keeps
   * the stored value (lets the UI round-trip its form untouched).
   */
  async updateGroup(
    schoolId: string,
    group: SettingsGroup,
    payload: Record<string, unknown>,
    actor: AccessTokenPayload,
  ): Promise<SettingView[]> {
    const defs = new Map(groupDefinitions(group).map((d) => [d.key, d]));

    const entries: Array<{ key: string; value: Prisma.InputJsonValue }> = [];
    const auditOld: Record<string, unknown> = {};
    const auditNew: Record<string, unknown> = {};
    const before = await this.getGroup(schoolId, group);
    const beforeByKey = new Map(before.map((v) => [v.key, v.value]));

    for (const [key, value] of Object.entries(payload)) {
      const def = defs.get(key);
      if (!def) {
        throw new BadRequestException(
          `Unknown setting "${key}" for group "${group}"`,
        );
      }
      if (def.secret && value === SECRET_MASK) continue; // keep stored
      this.assertType(def, value);

      const toStore =
        def.secret && typeof value === 'string' && value !== ''
          ? this.crypto.encrypt(value)
          : (value as Prisma.InputJsonValue);
      entries.push({ key, value: toStore });

      auditOld[key] = def.secret ? '[REDACTED]' : beforeByKey.get(key);
      auditNew[key] = def.secret ? '[REDACTED]' : value;
    }

    if (entries.length > 0) {
      await this.settings.upsertMany(schoolId, group, entries, actor.sub);
      await this.cache.del(cacheKey(schoolId, group));
    }

    this.auditContext.set({
      entityType: 'SchoolSettings',
      entityId: group,
      oldValues: auditOld,
      newValues: auditNew,
    });
    return this.getGroup(schoolId, group);
  }

  /** Cache bust hook (e.g. after a successful gateway test writes meta). */
  async invalidateGroup(schoolId: string, group: SettingsGroup): Promise<void> {
    await this.cache.del(cacheKey(schoolId, group));
  }

  // ── internals ─────────────────────────────────────────────────────

  /** Stored raw values for a group (secrets still encrypted), cached. */
  private async rawGroupValues(
    schoolId: string,
    group: SettingsGroup,
  ): Promise<Record<string, unknown>> {
    const key = cacheKey(schoolId, group);
    const cached = await this.cache.getJson<Record<string, unknown>>(key);
    if (cached) return cached;

    const rows = await this.settings.findGroup(schoolId, group);
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await this.cache.setJson(key, values, CACHE_TTL_SECONDS);
    return values;
  }

  private assertType(def: SettingDefinition, value: unknown): void {
    const ok =
      def.type === 'json'
        ? value !== undefined
        : def.type === 'string'
          ? typeof value === 'string'
          : def.type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === 'boolean';
    if (!ok) {
      throw new BadRequestException(
        `Setting "${def.key}" must be a ${def.type}`,
      );
    }
  }
}
