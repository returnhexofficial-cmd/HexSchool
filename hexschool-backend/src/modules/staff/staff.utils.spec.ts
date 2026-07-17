import { StaffDesignation } from '../../common/constants';
import { defaultRoleSlugFor, generateTempPassword } from './staff.utils';

describe('generateTempPassword', () => {
  it('always satisfies the M02 policy (≥8, upper, lower, digit)', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTempPassword();
      expect(password.length).toBeGreaterThanOrEqual(8);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/\d/);
    }
  });

  it('produces distinct values', () => {
    const set = new Set(
      Array.from({ length: 20 }, () => generateTempPassword()),
    );
    expect(set.size).toBe(20);
  });
});

describe('defaultRoleSlugFor', () => {
  it('maps privileged designations to their system roles', () => {
    expect(defaultRoleSlugFor(StaffDesignation.PRINCIPAL)).toBe('principal');
    expect(defaultRoleSlugFor(StaffDesignation.VICE_PRINCIPAL)).toBe(
      'vice-principal',
    );
    expect(defaultRoleSlugFor(StaffDesignation.ACCOUNTANT)).toBe('accountant');
    expect(defaultRoleSlugFor(StaffDesignation.ADMISSION_OFFICER)).toBe(
      'admission-officer',
    );
    expect(defaultRoleSlugFor(StaffDesignation.LIBRARIAN)).toBe('librarian');
  });

  it('falls back to office-staff for everyone else', () => {
    expect(defaultRoleSlugFor(StaffDesignation.SECURITY)).toBe('office-staff');
    expect(defaultRoleSlugFor(StaffDesignation.CLEANER)).toBe('office-staff');
    expect(defaultRoleSlugFor(StaffDesignation.OTHER)).toBe('office-staff');
  });
});
