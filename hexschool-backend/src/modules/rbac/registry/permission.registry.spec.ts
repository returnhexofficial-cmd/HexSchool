import { PERMISSION_CODES, PERMISSION_REGISTRY } from './permission.registry';
import { SYSTEM_ROLES } from './system-roles';

/**
 * Registry integrity: broken codes here would silently strand roles, so
 * the invariants are pinned by tests rather than convention alone.
 */
describe('permission registry', () => {
  it('codes are unique', () => {
    expect(PERMISSION_CODES.size).toBe(PERMISSION_REGISTRY.length);
  });

  it('codes follow the "<entity>.<action>" dotted format', () => {
    const pattern = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
    for (const def of PERMISSION_REGISTRY) {
      expect(def.code).toMatch(pattern);
      expect(def.module.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('system role slugs are unique and kebab-case', () => {
    const slugs = SYSTEM_ROLES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  it('every system-role core permission exists in the registry', () => {
    for (const role of SYSTEM_ROLES) {
      for (const code of role.corePermissions) {
        expect(PERMISSION_CODES.has(code)).toBe(true);
      }
    }
  });
});
