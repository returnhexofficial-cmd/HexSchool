import {
  bedAvailability,
  bedCountMismatch,
  canAllocate,
  genderMatches,
  summarize,
  type AllocationCandidate,
} from './occupancy.engine';

const ok: AllocationCandidate = {
  bedStatus: 'VACANT',
  bedHeld: false,
  roomStatus: 'ACTIVE',
  hostelActive: true,
  hostelType: 'BOYS',
  studentGender: 'MALE',
  alreadyResident: false,
  override: false,
};

describe('genderMatches', () => {
  it('matches a boy to the boys hostel and a girl to the girls', () => {
    expect(genderMatches('BOYS', 'MALE')).toBe(true);
    expect(genderMatches('GIRLS', 'FEMALE')).toBe(true);
  });

  it('never matches the wrong way round', () => {
    expect(genderMatches('BOYS', 'FEMALE')).toBe(false);
    expect(genderMatches('GIRLS', 'MALE')).toBe(false);
  });

  it('matches OTHER to neither — the caller decides what to do about it', () => {
    expect(genderMatches('BOYS', 'OTHER')).toBe(false);
    expect(genderMatches('GIRLS', 'OTHER')).toBe(false);
  });
});

describe('canAllocate — structural refusals', () => {
  it('allows a clean allocation', () => {
    expect(canAllocate(ok)).toEqual({
      allowed: true,
      structural: false,
      warn: false,
      reason: null,
      overridable: false,
    });
  });

  it('refuses a bed somebody is already in, and no override touches it', () => {
    const held = canAllocate({ ...ok, bedHeld: true, override: true });
    expect(held.allowed).toBe(false);
    expect(held.structural).toBe(true);
    expect(held.overridable).toBe(false);
  });

  it('refuses a bed marked OCCUPIED even with no live allocation row', () => {
    // The shadow disagreeing with the index is a data problem; refusing
    // is the safe direction.
    expect(canAllocate({ ...ok, bedStatus: 'OCCUPIED' }).allowed).toBe(false);
  });

  it('refuses a student who already has a bed', () => {
    const second = canAllocate({
      ...ok,
      alreadyResident: true,
      override: true,
    });
    expect(second.allowed).toBe(false);
    expect(second.structural).toBe(true);
    expect(second.reason).toMatch(/Transfer them/);
  });

  it('refuses a boy in the girls hostel, override or not', () => {
    const wrong = canAllocate({
      ...ok,
      hostelType: 'GIRLS',
      studentGender: 'MALE',
      override: true,
    });
    expect(wrong.allowed).toBe(false);
    expect(wrong.structural).toBe(true);
    expect(wrong.overridable).toBe(false);
  });

  it('reports the bed before the room — the clerk must fix the right thing', () => {
    const both = canAllocate({
      ...ok,
      bedHeld: true,
      roomStatus: 'MAINTENANCE',
    });
    expect(both.reason).toMatch(/already has a boarder/);
  });
});

describe('canAllocate — policy refusals', () => {
  it('refuses an inactive hostel but says an override would pass', () => {
    const verdict = canAllocate({ ...ok, hostelActive: false });
    expect(verdict.allowed).toBe(false);
    expect(verdict.structural).toBe(false);
    expect(verdict.overridable).toBe(true);
  });

  it('lets the override through, and warns rather than going silent', () => {
    const verdict = canAllocate({ ...ok, hostelActive: false, override: true });
    expect(verdict.allowed).toBe(true);
    expect(verdict.warn).toBe(true);
    expect(verdict.reason).toMatch(/override/);
  });

  it('refuses a bed or a room under maintenance, overridably', () => {
    for (const candidate of [
      { ...ok, bedStatus: 'MAINTENANCE' as const },
      { ...ok, roomStatus: 'MAINTENANCE' as const },
    ]) {
      expect(canAllocate(candidate).allowed).toBe(false);
      expect(canAllocate(candidate).overridable).toBe(true);
      expect(canAllocate({ ...candidate, override: true }).allowed).toBe(true);
    }
  });

  it('makes an OTHER gender a decision with a name on it, not a refusal', () => {
    const blocked = canAllocate({ ...ok, studentGender: 'OTHER' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.structural).toBe(false);
    expect(blocked.overridable).toBe(true);

    const allowed = canAllocate({
      ...ok,
      studentGender: 'OTHER',
      override: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.warn).toBe(true);
  });
});

describe('bedAvailability', () => {
  it('reads maintenance ahead of occupancy', () => {
    expect(bedAvailability('MAINTENANCE', true)).toBe('MAINTENANCE');
  });

  it('calls a bed taken when either the row or the shadow says so', () => {
    expect(bedAvailability('VACANT', true)).toBe('TAKEN');
    expect(bedAvailability('OCCUPIED', false)).toBe('TAKEN');
  });

  it('calls an untouched bed free', () => {
    expect(bedAvailability('VACANT', false)).toBe('FREE');
  });
});

describe('summarize', () => {
  it('counts an empty hostel without dividing by zero', () => {
    expect(summarize([])).toEqual({
      total: 0,
      occupied: 0,
      vacant: 0,
      maintenance: 0,
      available: 0,
      utilization: 0,
    });
  });

  it('takes beds out of service out of the denominator', () => {
    // 2 of 3 serviceable beds taken — 66.7 %, not 50 %.
    const stats = summarize([
      { status: 'VACANT', held: true },
      { status: 'VACANT', held: true },
      { status: 'VACANT', held: false },
      { status: 'MAINTENANCE', held: false },
    ]);
    expect(stats).toEqual({
      total: 4,
      occupied: 2,
      vacant: 1,
      maintenance: 1,
      available: 1,
      utilization: 66.7,
    });
  });

  it('reports 100 % for a full hostel and 0 % for an empty one', () => {
    expect(
      summarize([
        { status: 'OCCUPIED', held: true },
        { status: 'OCCUPIED', held: true },
      ]).utilization,
    ).toBe(100);
    expect(
      summarize([
        { status: 'VACANT', held: false },
        { status: 'VACANT', held: false },
      ]).utilization,
    ).toBe(0);
  });

  it('reports zero utilization when every bed is out of service', () => {
    expect(
      summarize([
        { status: 'MAINTENANCE', held: false },
        { status: 'MAINTENANCE', held: false },
      ]).utilization,
    ).toBe(0);
  });
});

describe('bedCountMismatch', () => {
  it('says nothing when intent and reality agree', () => {
    expect(bedCountMismatch(4, 4)).toBeNull();
  });

  it('reports an over-stuffed room', () => {
    expect(bedCountMismatch(3, 4)).toMatch(/4 beds are recorded/);
  });

  it('reports a half-generated room', () => {
    expect(bedCountMismatch(4, 2)).toMatch(/2 of 4 declared/);
  });
});
