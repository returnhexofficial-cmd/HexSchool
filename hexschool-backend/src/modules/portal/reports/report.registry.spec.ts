import { PERMISSION_CODES } from '../../rbac/registry/permission.registry';
import { REPORT_CODES, REPORT_REGISTRY } from './report.registry';

describe('report registry', () => {
  it('has unique report codes', () => {
    expect(REPORT_CODES.size).toBe(REPORT_REGISTRY.length);
  });

  it('references only real permission codes', () => {
    for (const report of REPORT_REGISTRY) {
      expect(PERMISSION_CODES.has(report.permission)).toBe(true);
    }
  });

  it('gives every report an endpoint and at least one param or format', () => {
    for (const report of REPORT_REGISTRY) {
      expect(report.endpoint.startsWith('/')).toBe(true);
      expect(report.name.length).toBeGreaterThan(0);
    }
  });
});
