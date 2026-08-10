import {
  batchYearRefusal,
  capacityWarning,
  claimConflictRefusal,
  matchHints,
  matchScore,
  nameSimilarity,
  publicDirectory,
  publicProfile,
  registrationClosedRefusal,
  seatsFor,
  type AlumniRecord,
  type GraduateCandidate,
} from './alumni.engine';

function alumni(over: Partial<AlumniRecord> = {}): AlumniRecord {
  return {
    id: 'a1',
    name: 'Farhana Akter',
    batchYear: 2015,
    lastClass: 'Class 10',
    phone: '01712345678',
    email: 'farhana@example.com',
    address: '12 Green Road, Dhaka',
    profession: 'Doctor',
    organization: 'Dhaka Medical College',
    photoUrl: null,
    bio: 'Paediatrics.',
    isPublicProfile: true,
    status: 'APPROVED',
    ...over,
  };
}

describe('alumni.engine — the directory privacy filter (roadmap §6)', () => {
  it('never publishes a phone number, an email or an address', () => {
    const profile = publicProfile(alumni());
    expect(profile).not.toBeNull();
    expect(Object.keys(profile!)).toEqual([
      'id',
      'name',
      'batchYear',
      'lastClass',
      'profession',
      'organization',
      'photoUrl',
      'bio',
    ]);
    expect(JSON.stringify(profile)).not.toContain('01712345678');
    expect(JSON.stringify(profile)).not.toContain('farhana@example.com');
    expect(JSON.stringify(profile)).not.toContain('Green Road');
  });

  it('returns null — not a trimmed object — for somebody who has not opted in', () => {
    expect(publicProfile(alumni({ isPublicProfile: false }))).toBeNull();
  });

  it('returns null for a profile that is not approved, however it is flagged', () => {
    expect(publicProfile(alumni({ status: 'PENDING' }))).toBeNull();
    expect(publicProfile(alumni({ status: 'REJECTED' }))).toBeNull();
  });

  it('filters a directory to the approved opted-in rows', () => {
    const rows = [
      alumni({ id: 'yes' }),
      alumni({ id: 'private', isPublicProfile: false }),
      alumni({ id: 'pending', status: 'PENDING' }),
    ];
    expect(publicDirectory(rows).map((p) => p.id)).toEqual(['yes']);
  });
});

describe('alumni.engine — batch year (roadmap §7)', () => {
  it('accepts a year inside the range', () => {
    expect(batchYearRefusal(2015, 2026, 1950)).toBeNull();
  });

  it("refuses a year before the school's floor", () => {
    expect(batchYearRefusal(1949, 2026, 1950)).toContain('1950');
  });

  it('refuses a future batch — somebody finishing in December is still a student', () => {
    expect(batchYearRefusal(2027, 2026, 1950)).toContain('future');
  });

  it('accepts the current year', () => {
    expect(batchYearRefusal(2026, 2026, 1950)).toBeNull();
  });

  it('refuses a fractional year', () => {
    expect(batchYearRefusal(2015.5, 2026, 1950)).toContain('whole year');
  });
});

describe('alumni.engine — match hints (roadmap §4)', () => {
  function graduate(over: Partial<GraduateCandidate> = {}): GraduateCandidate {
    return {
      studentId: 's1',
      studentUid: 'HS-2015-00001',
      name: 'Farhana Akter',
      graduationYear: 2015,
      lastClass: 'Class 10',
      phone: '01712345678',
      ...over,
    };
  }

  const claim = {
    name: 'Farhana Akter',
    batchYear: 2015,
    phone: '01712345678',
  };

  it('scores a phone + name + year match at the top', () => {
    expect(matchScore(claim, graduate()).score).toBe(100);
  });

  it('weights the phone number above the name — it is the strongest thing a BD school holds', () => {
    const phoneOnly = matchScore(
      { name: 'Someone Else', batchYear: 2015, phone: '01712345678' },
      graduate({ name: 'Farhana Akter', graduationYear: 2001 }),
    );
    const nameOnly = matchScore(
      { name: 'Farhana Akter', batchYear: 2015, phone: null },
      graduate({ phone: '01799999999', graduationYear: 2001 }),
    );
    expect(phoneOnly.score).toBeGreaterThan(nameOnly.score);
  });

  it('gives partial credit for a batch year one out', () => {
    const exact = matchScore(claim, graduate({ graduationYear: 2015 }));
    const near = matchScore(claim, graduate({ graduationYear: 2016 }));
    const far = matchScore(claim, graduate({ graduationYear: 2005 }));
    expect(exact.score).toBeGreaterThan(near.score);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('flags a candidate somebody has already claimed', () => {
    const hint = matchScore(claim, graduate(), new Set(['s1']));
    expect(hint.alreadyClaimed).toBe(true);
  });

  it('ranks and truncates, dropping candidates with no signal at all', () => {
    const hints = matchHints(
      claim,
      [
        graduate({ studentId: 's1', studentUid: 'A', name: 'Farhana Akter' }),
        graduate({
          studentId: 's2',
          studentUid: 'B',
          name: 'Kamrul Hasan',
          phone: '01555555555',
          graduationYear: 1990,
        }),
      ],
      new Set(),
      5,
    );
    expect(hints.map((h) => h.studentId)).toEqual(['s1']);
  });

  it('breaks a tie deterministically in both id orders — the M14 lesson', () => {
    const a = graduate({ studentId: 's1', studentUid: 'AAA' });
    const b = graduate({ studentId: 's2', studentUid: 'ZZZ' });
    expect(matchHints(claim, [a, b]).map((h) => h.studentUid)).toEqual([
      'AAA',
      'ZZZ',
    ]);
    expect(matchHints(claim, [b, a]).map((h) => h.studentUid)).toEqual([
      'AAA',
      'ZZZ',
    ]);
  });

  it('normalizes the honorifics a BD register actually holds', () => {
    expect(nameSimilarity('Md. Rahman', 'Mohammad Rahman')).toBe(1);
    expect(nameSimilarity('MD RAHMAN', 'Md Rahman')).toBe(1);
    expect(nameSimilarity('Md. Rahman', 'Md. Karim')).toBeCloseTo(0.5);
    expect(nameSimilarity('', 'Md. Rahman')).toBe(0);
  });
});

describe('alumni.engine — the conflict queue (roadmap §8)', () => {
  it('refuses to approve a claim on a student somebody else already holds', () => {
    expect(
      claimConflictRefusal({
        studentId: 's1',
        claimedStudentIds: new Set(['s1']),
        ownStudentId: null,
      }),
    ).toContain('already been approved');
  });

  it('lets a row keep its own claim on re-approval', () => {
    expect(
      claimConflictRefusal({
        studentId: 's1',
        claimedStudentIds: new Set(['s1']),
        ownStudentId: 's1',
      }),
    ).toBeNull();
  });

  it('never blocks an unlinked alumnus — forty years of pre-system graduates', () => {
    expect(
      claimConflictRefusal({
        studentId: null,
        claimedStudentIds: new Set(['s1']),
        ownStudentId: null,
      }),
    ).toBeNull();
  });
});

describe('alumni.engine — events', () => {
  it('counts an alumnus plus their guests against capacity', () => {
    expect(seatsFor(0)).toBe(1);
    expect(seatsFor(3)).toBe(4);
    expect(seatsFor(-2)).toBe(1);
  });

  it('warns over capacity rather than refusing — the M25 bus rule', () => {
    expect(capacityWarning({ capacity: 100, taken: 99 }, 1)).toBeNull();
    expect(capacityWarning({ capacity: 100, taken: 99 }, 3)).toContain(
      '102 of 100',
    );
  });

  it('never warns for an event with no capacity set', () => {
    expect(capacityWarning({ capacity: null, taken: 5000 }, 10)).toBeNull();
  });

  it('closes registration on the deadline, falling back to the event date', () => {
    const eventDate = new Date('2026-09-01T00:00:00.000Z');
    const deadline = new Date('2026-08-25T00:00:00.000Z');

    expect(
      registrationClosedRefusal(
        deadline,
        eventDate,
        new Date('2026-08-25T18:00:00.000Z'),
      ),
    ).toBeNull();
    expect(
      registrationClosedRefusal(
        deadline,
        eventDate,
        new Date('2026-08-26T01:00:00.000Z'),
      ),
    ).toContain('2026-08-25');
    expect(
      registrationClosedRefusal(
        null,
        eventDate,
        new Date('2026-09-02T01:00:00.000Z'),
      ),
    ).toContain('2026-09-01');
  });
});
