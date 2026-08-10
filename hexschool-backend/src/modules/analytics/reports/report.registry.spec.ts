import { PERMISSION_CODES } from '../../rbac/registry/permission.registry';
import { SETTINGS_REGISTRY } from '../../school/settings/settings.registry';
import { validateParams } from '../calc/param.engine';
import {
  REPORT_CODES,
  REPORT_REGISTRY,
  reportDefinition,
} from './report.registry';
import { AccountingReportExecutors } from './executors/accounting.executors';
import { AnalyticsReportExecutors } from './executors/analytics.executors';
import { AttendanceReportExecutors } from './executors/attendance.executors';
import { CommunicationReportExecutors } from './executors/communication.executors';
import { CommunityReportExecutors } from './executors/community.executors';
import { FeeReportExecutors } from './executors/fee.executors';
import { HostelReportExecutors } from './executors/hostel.executors';
import { InventoryReportExecutors } from './executors/inventory.executors';
import { LibraryReportExecutors } from './executors/library.executors';
import { PayrollReportExecutors } from './executors/payroll.executors';
import { ResultReportExecutors } from './executors/result.executors';
import { TransportReportExecutors } from './executors/transport.executors';

/**
 * The registry is append-only and test-enforced — the
 * `permission.registry` / `settings.registry` convention, third use.
 *
 * The two invariants that matter most are the **runnable ⇄ executor**
 * pair. They are asserted here rather than only logged at boot because
 * the seeder writes `is_runnable` from the file's claim (it runs
 * standalone and cannot see the DI graph), so a lie in the file becomes a
 * lie in the database and then a Run button on a report that cannot run.
 *
 * Reading the codes off the executor classes' prototypes rather than
 * instantiating them keeps this a pure unit test — the providers take
 * eleven injected services between them, and none of that is needed to
 * ask which codes each one claims.
 */

/** The executor providers, and the codes each binds. */
const PROVIDERS = [
  AttendanceReportExecutors,
  ResultReportExecutors,
  FeeReportExecutors,
  AccountingReportExecutors,
  PayrollReportExecutors,
  LibraryReportExecutors,
  TransportReportExecutors,
  InventoryReportExecutors,
  HostelReportExecutors,
  CommunityReportExecutors,
  CommunicationReportExecutors,
  AnalyticsReportExecutors,
];

function boundCodes(): string[] {
  const codes: string[] = [];
  for (const Provider of PROVIDERS) {
    // `executors()` only reads `this` to build closures, so an instance
    // with no dependencies answers the question correctly.
    const instance = Object.create(Provider.prototype) as {
      executors: () => Record<string, unknown>;
    };
    codes.push(...Object.keys(instance.executors()));
  }
  return codes;
}

describe('REPORT_REGISTRY', () => {
  it('has unique codes', () => {
    const codes = REPORT_REGISTRY.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names a permission that exists in the permission registry', () => {
    const unknown = REPORT_REGISTRY.filter(
      (r) => !PERMISSION_CODES.has(r.permission),
    ).map((r) => `${r.code} → ${r.permission}`);
    expect(unknown).toEqual([]);
  });

  it('names a sensitive permission that exists, when it names one', () => {
    const unknown = REPORT_REGISTRY.filter(
      (r) =>
        r.sensitivePermission && !PERMISSION_CODES.has(r.sensitivePermission),
    ).map((r) => `${r.code} → ${r.sensitivePermission ?? ''}`);
    expect(unknown).toEqual([]);
  });

  it('gives every report at least one export format', () => {
    const formatless = REPORT_REGISTRY.filter((r) => r.formats.length === 0);
    expect(formatless.map((r) => r.code)).toEqual([]);
  });

  it('has a name, a module and a description on every entry', () => {
    for (const definition of REPORT_REGISTRY) {
      expect(definition.name.trim().length).toBeGreaterThan(0);
      expect(definition.module.trim().length).toBeGreaterThan(0);
      expect(definition.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every param a unique key within its report', () => {
    for (const definition of REPORT_REGISTRY) {
      const keys = definition.params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every enum param its options', () => {
    for (const definition of REPORT_REGISTRY) {
      for (const param of definition.params) {
        if (param.type === 'enum') {
          expect(param.options?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it('accepts an empty bag for every report with no required params', () => {
    // A report whose params are all optional must be schedulable with no
    // configuration at all — that is what a "daily collection, emailed at
    // seven" schedule is.
    for (const definition of REPORT_REGISTRY) {
      if (definition.params.some((p) => p.required)) continue;
      expect(validateParams(definition.params, {}).ok).toBe(true);
    }
  });

  it('exposes REPORT_CODES matching the registry', () => {
    expect(REPORT_CODES.size).toBe(REPORT_REGISTRY.length);
  });

  it('looks a definition up by code', () => {
    expect(reportDefinition('fee.dues')?.name).toBe('Dues & aging');
    expect(reportDefinition('nope.nothing')).toBeUndefined();
  });
});

describe('executors ⇄ registry', () => {
  it('binds no executor twice', () => {
    const codes = boundCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('binds an executor for every code marked runnable', () => {
    const bound = new Set(boundCodes());
    const missing = REPORT_REGISTRY.filter(
      (r) => r.runnable && !bound.has(r.code),
    ).map((r) => r.code);
    // A Run button on a report with no generator queues a job that can
    // only ever fail.
    expect(missing).toEqual([]);
  });

  it('binds no executor for a code the registry does not declare', () => {
    const unknown = boundCodes().filter((code) => !REPORT_CODES.has(code));
    // The catalog is what offers a report, so an unlisted executor is
    // unreachable code.
    expect(unknown).toEqual([]);
  });

  it('marks runnable every code that has an executor', () => {
    const bound = new Set(boundCodes());
    const understated = REPORT_REGISTRY.filter(
      (r) => !r.runnable && bound.has(r.code),
    ).map((r) => r.code);
    expect(understated).toEqual([]);
  });
});

describe('the analytics settings group', () => {
  it('declares every key AnalyticsSettingsService reads', () => {
    const declared = new Set(
      SETTINGS_REGISTRY.filter((s) => s.group === 'analytics').map(
        (s) => s.key,
      ),
    );
    for (const key of [
      'analytics.enabled',
      'analytics.report_retention_days',
      'analytics.report_max_rows',
      'analytics.schedule_max_failures',
      'analytics.schedule_attach_files',
      'analytics.schedule_attach_max_bytes',
      'analytics.mv_refresh_time',
      'analytics.website_tracking_enabled',
      'analytics.website_visitor_salt',
      'analytics.website_top_n',
    ]) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it('keeps the visitor salt a secret', () => {
    const salt = SETTINGS_REGISTRY.find(
      (s) => s.key === 'analytics.website_visitor_salt',
    );
    // With the salt readable, anybody could compute the fingerprint for a
    // given IP and user agent — which is the linkability the HyperLogLog
    // exists to prevent.
    expect(salt?.secret).toBe(true);
  });
});
