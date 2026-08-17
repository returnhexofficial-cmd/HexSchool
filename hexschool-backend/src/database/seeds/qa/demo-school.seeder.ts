/**
 * QA demo-school seeder — the spine a browser-QA round needs before it can
 * exercise anything beyond the login page.
 *
 * The bootstrap seeders (`npm run seed`) deliberately create reference data
 * only: the permission registry, 11 system roles, the NCTB grade scale, the
 * chart of accounts — plus exactly one user. That is correct for a fresh
 * deployment and useless for QA, which needs a *populated* school and, above
 * all, **a login per role** so permission boundaries and the portals can be
 * tested at all.
 *
 * Destructive and re-runnable: everything it creates is tagged and purged on
 * the next run. Guarded to localhost — see ./guard.ts.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { ensureUserRole } from '../../../modules/rbac/seed/rbac.seeder';

/** Shared password for every seeded QA account. */
export const QA_PASSWORD = 'QaPass123!';
/** Every QA-owned account lives on this domain, which is also how we purge. */
export const QA_EMAIL_DOMAIN = 'qa.hexschool.local';

type Ctx = {
  prisma: PrismaClient;
  schoolId: string;
  passwordHash: string;
  log: (msg: string) => void;
};

/* ── role → account map ──────────────────────────────────────────────────
 * One login per system role. `userType` drives the portal/shell the account
 * lands in; `roleSlug` drives the permission set. Keep these in sync with
 * seedSystemRoles() in modules/rbac/seed/rbac.seeder.ts.
 */
export const QA_ACCOUNTS = [
  { key: 'admin', roleSlug: 'admin', userType: 'ADMIN' },
  { key: 'principal', roleSlug: 'principal', userType: 'STAFF' },
  { key: 'viceprincipal', roleSlug: 'vice-principal', userType: 'STAFF' },
  { key: 'office', roleSlug: 'office-staff', userType: 'STAFF' },
  { key: 'accountant', roleSlug: 'accountant', userType: 'STAFF' },
  { key: 'admissions', roleSlug: 'admission-officer', userType: 'STAFF' },
  { key: 'librarian', roleSlug: 'librarian', userType: 'STAFF' },
  { key: 'teacher', roleSlug: 'teacher', userType: 'TEACHER' },
  { key: 'teacher2', roleSlug: 'teacher', userType: 'TEACHER' },
  { key: 'student', roleSlug: 'student', userType: 'STUDENT' },
  { key: 'parent', roleSlug: 'parent', userType: 'PARENT' },
] as const;

export const qaEmail = (key: string): string => `${key}@${QA_EMAIL_DOMAIN}`;

/* ── Bangla-bearing fixture names ────────────────────────────────────────
 * The product targets Bangladeshi schools, so Unicode must survive every
 * form, table, export and print path. Seeding Bangla by default means every
 * module's QA exercises it without a special scenario.
 */
const STUDENT_NAMES: Array<[first: string, last: string, bn: string]> = [
  ['Ayesha', 'Rahman', 'আয়েশা রহমান'],
  ['Tanvir', 'Hasan', 'তানভীর হাসান'],
  ['Nusrat', 'Jahan', 'নুসরাত জাহান'],
  ['Rafiul', 'Islam', 'রফিউল ইসলাম'],
  ['Sadia', 'Akter', 'সাদিয়া আক্তার'],
  ['Mehedi', 'Hassan', 'মেহেদী হাসান'],
  ['Farhana', 'Yasmin', 'ফারহানা ইয়াসমিন'],
  ['Imran', 'Kabir', 'ইমরান কবির'],
  ['Sumaiya', 'Binte Alam', 'সুমাইয়া বিনতে আলম'],
  ['Arif', 'Chowdhury', 'আরিফ চৌধুরী'],
  ['Jarin', 'Tasnim', 'জারিন তাসনিম'],
  ['Shakib', 'Al Hasan', 'সাকিব আল হাসান'],
];

const pad = (n: number, w = 3): string => String(n).padStart(w, '0');
const date = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

/** BD mobile numbers, unique per index, in the 01[3-9] format the app validates. */
const bdPhone = (i: number): string => `018${pad(i, 8)}`;

/* ───────────────────────────── purge ──────────────────────────────────── */

/**
 * Remove everything a previous QA round created, so the seed is re-runnable.
 * Also clears the `e2e-*@test.local` users the HR e2e suite leaks (QA finding
 * F7) — they pollute the user list and every staff-count statistic.
 */
async function purge(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;

  const sessions = await prisma.academicSession.findMany({
    where: { name: { startsWith: 'QA ' } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  // Sections and enrollments cascade from the academic session, which takes
  // most of the tree with it (the pattern the e2e suites use).
  if (sessionIds.length > 0) {
    await prisma.academicSession.deleteMany({
      where: { id: { in: sessionIds } },
    });
  }

  await prisma.studentGuardian.deleteMany({
    where: { student: { studentUid: { startsWith: 'QA-' } } },
  });
  await prisma.student.deleteMany({
    where: { studentUid: { startsWith: 'QA-' } },
  });
  await prisma.guardian.deleteMany({ where: { name: { startsWith: 'QA ' } } });
  await prisma.teacher.deleteMany({
    where: { employeeId: { startsWith: 'QA-' } },
  });
  await prisma.staffProfile.deleteMany({
    where: { employeeId: { startsWith: 'QA-' } },
  });

  await prisma.section.deleteMany({ where: { roomNo: { startsWith: 'QA' } } });
  await prisma.schoolClass.deleteMany({
    where: { name: { startsWith: 'QA ' } },
  });
  await prisma.subject.deleteMany({ where: { code: { startsWith: 'QA-' } } });
  await prisma.department.deleteMany({
    where: { code: { startsWith: 'QA-' } },
  });
  await prisma.shift.deleteMany({ where: { name: { startsWith: 'QA ' } } });

  const purgedUsers = await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { endsWith: `@${QA_EMAIL_DOMAIN}` } },
        // F7: HR e2e fixture users that its cleanup() never removes.
        { email: { endsWith: '@test.local' } },
      ],
    },
  });

  ctx.log(`purged ${purgedUsers.count} users, ${sessionIds.length} sessions`);
}

/* ─────────────────────────── accounts ─────────────────────────────────── */

async function seedAccounts(ctx: Ctx): Promise<Map<string, string>> {
  const { prisma, schoolId, passwordHash } = ctx;
  const ids = new Map<string, string>();

  for (const acct of QA_ACCOUNTS) {
    const user = await prisma.user.create({
      data: {
        schoolId,
        email: qaEmail(acct.key),
        passwordHash,
        userType: acct.userType,
        // QA logs in constantly; a forced-change interstitial on every
        // account would make every test start with a detour.
        mustChangePassword: false,
      },
    });
    await ensureUserRole(prisma, user.id, schoolId, acct.roleSlug);
    ids.set(acct.key, user.id);
  }

  ctx.log(`${ids.size} accounts, all password "${QA_PASSWORD}"`);
  return ids;
}

/* ──────────────────────────── structure ───────────────────────────────── */

type Structure = {
  currentSessionId: string;
  previousSessionId: string;
  classIds: string[];
  sectionIds: string[];
  subjectIds: string[];
  departmentId: string;
  shiftId: string;
};

async function seedStructure(ctx: Ctx): Promise<Structure> {
  const { prisma, schoolId } = ctx;
  const thisYear = new Date().getUTCFullYear();

  // Two sessions: one ACTIVE/current, one COMPLETED. The completed one is not
  // decoration — COMPLETED sessions are read-only for attendance and marks
  // entry, and the session switcher needs something to switch to.
  const previous = await prisma.academicSession.create({
    data: {
      schoolId,
      name: `QA ${thisYear - 1}`,
      startDate: date(thisYear - 1, 1, 1),
      endDate: date(thisYear - 1, 12, 31),
      status: 'COMPLETED',
      isCurrent: false,
    },
  });

  // Exactly one session may be is_current (DB partial unique index), so stand
  // down whatever currently holds the flag before claiming it.
  await prisma.academicSession.updateMany({
    where: { schoolId, isCurrent: true },
    data: { isCurrent: false },
  });

  const current = await prisma.academicSession.create({
    data: {
      schoolId,
      name: `QA ${thisYear}`,
      startDate: date(thisYear, 1, 1),
      endDate: date(thisYear, 12, 31),
      status: 'ACTIVE',
      isCurrent: true,
    },
  });

  const department = await prisma.department.create({
    data: { schoolId, name: 'QA Science', code: 'QA-SCI' },
  });

  const shift = await prisma.shift.create({
    data: {
      schoolId,
      name: 'QA Morning',
      startTime: new Date('1970-01-01T07:30:00Z'),
      endTime: new Date('1970-01-01T12:30:00Z'),
    },
  });

  const subjects = await Promise.all(
    [
      ['QA-BAN', 'Bangla', 'বাংলা'],
      ['QA-ENG', 'English', 'ইংরেজি'],
      ['QA-MAT', 'Mathematics', 'গণিত'],
      ['QA-SCI', 'Science', 'বিজ্ঞান'],
    ].map(([code, name, nameBn]) =>
      prisma.subject.create({
        data: { schoolId, code, name, nameBn, departmentId: department.id },
      }),
    ),
  );

  const classIds: string[] = [];
  const sectionIds: string[] = [];

  for (const level of [6, 7, 8]) {
    const cls = await prisma.schoolClass.create({
      data: {
        schoolId,
        name: `QA Class ${level}`,
        nameBn: `ষষ্ঠ-${level}`,
        numericLevel: level,
        displayOrder: level,
      },
    });
    classIds.push(cls.id);

    // Sections exist per session, so both sessions get them — that is what
    // makes the session-scoping sweep meaningful.
    for (const sessionId of [current.id, previous.id]) {
      for (const name of ['A', 'B']) {
        const section = await prisma.section.create({
          data: {
            schoolId,
            classId: cls.id,
            sessionId,
            name,
            shiftId: shift.id,
            capacity: 30,
            roomNo: `QA${level}${name}`,
          },
        });
        if (sessionId === current.id) sectionIds.push(section.id);
      }
    }
  }

  ctx.log(
    `2 sessions (${current.name} current, ${previous.name} completed), ` +
      `${classIds.length} classes, ${sectionIds.length} current-session sections, ` +
      `${subjects.length} subjects`,
  );

  return {
    currentSessionId: current.id,
    previousSessionId: previous.id,
    classIds,
    sectionIds,
    subjectIds: subjects.map((s) => s.id),
    departmentId: department.id,
    shiftId: shift.id,
  };
}

/* ──────────────────────── staff and teachers ──────────────────────────── */

async function seedStaff(
  ctx: Ctx,
  users: Map<string, string>,
  structure: Structure,
): Promise<void> {
  const { prisma, schoolId } = ctx;

  const staffDesignations: Array<[key: string, designation: string]> = [
    ['principal', 'PRINCIPAL'],
    ['viceprincipal', 'VICE_PRINCIPAL'],
    ['office', 'OFFICE_STAFF'],
    ['accountant', 'ACCOUNTANT'],
    ['admissions', 'ADMISSION_OFFICER'],
    ['librarian', 'LIBRARIAN'],
  ];

  let n = 1;
  for (const [key, designation] of staffDesignations) {
    const userId = users.get(key);
    if (!userId) continue;
    await prisma.staffProfile.create({
      data: {
        schoolId,
        userId,
        employeeId: `QA-S${pad(n)}`,
        firstName: 'QA',
        lastName: designation
          .split('_')
          .map((w) => w[0] + w.slice(1).toLowerCase())
          .join(' '),
        designation:
          designation as Prisma.StaffProfileCreateInput['designation'],
        departmentId: structure.departmentId,
        gender: n % 2 === 0 ? 'FEMALE' : 'MALE',
        dob: date(1985, ((n * 3) % 12) + 1, 15),
        joiningDate: date(2018, 1, 10),
      },
    });
    n += 1;
  }

  // Two teachers: `teacher` holds sections today; `teacher2` is the one a
  // roster reassignment can move rights *to*. M22's policy service re-reads
  // teacher_section_subjects live on every request, so a browser test needs
  // both sides to prove it.
  const teacherKeys: Array<[string, string]> = [
    ['teacher', 'Rahim Uddin'],
    ['teacher2', 'Nasrin Sultana'],
  ];
  let t = 1;
  for (const [key, fullName] of teacherKeys) {
    const userId = users.get(key);
    if (!userId) continue;
    const [firstName, ...rest] = fullName.split(' ');
    await prisma.teacher.create({
      data: {
        schoolId,
        userId,
        employeeId: `QA-T${pad(t)}`,
        firstName,
        lastName: rest.join(' '),
        nameBn: t === 1 ? 'রহিম উদ্দিন' : 'নাসরিন সুলতানা',
        designation: 'ASSISTANT_TEACHER',
        departmentId: structure.departmentId,
        gender: t === 1 ? 'MALE' : 'FEMALE',
        dob: date(1988, 5, 20),
        joiningDate: date(2019, 3, 1),
      },
    });
    t += 1;
  }

  ctx.log(
    `${staffDesignations.length} staff profiles, ${teacherKeys.length} teachers`,
  );
}

/* ─────────────────── students, guardians, enrollments ─────────────────── */

async function seedStudents(
  ctx: Ctx,
  users: Map<string, string>,
  structure: Structure,
): Promise<void> {
  const { prisma, schoolId } = ctx;
  const thisYear = new Date().getUTCFullYear();

  const studentUserId = users.get('student');
  const parentUserId = users.get('parent');

  // The parent account owns two children. That is the fixture the portal
  // child-switcher needs, and it is the sharpest test of assertOwnsStudent —
  // the single IDOR chokepoint for every portal route.
  const parentGuardian = await prisma.guardian.create({
    data: {
      schoolId,
      userId: parentUserId,
      name: 'QA Parent Guardian',
      nameBn: 'কিউএ অভিভাবক',
      relation: 'FATHER',
      phone: bdPhone(1),
      email: qaEmail('parent'),
    },
  });

  const rollByCity = new Map<string, number>();
  let created = 0;

  for (let i = 0; i < STUDENT_NAMES.length; i += 1) {
    const [firstName, lastName, nameBn] = STUDENT_NAMES[i];
    const sectionId = structure.sectionIds[i % structure.sectionIds.length];
    const section = await prisma.section.findUniqueOrThrow({
      where: { id: sectionId },
      select: { id: true, classId: true, shiftId: true },
    });

    const roll = (rollByCity.get(sectionId) ?? 0) + 1;
    rollByCity.set(sectionId, roll);

    const student = await prisma.student.create({
      data: {
        schoolId,
        // The first student *is* the student-portal login.
        userId: i === 0 ? studentUserId : undefined,
        studentUid: `QA-${thisYear}-${pad(i + 1, 4)}`,
        firstName,
        lastName,
        nameBn,
        gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
        dob: date(thisYear - 12, ((i * 5) % 12) + 1, ((i * 7) % 27) + 1),
        religion: i % 5 === 0 ? 'HINDUISM' : 'ISLAM',
        admissionDate: date(thisYear, 1, 5),
        admissionClassId: section.classId,
        qrToken: crypto.randomBytes(24).toString('hex'),
      },
    });

    await prisma.enrollment.create({
      data: {
        schoolId,
        studentId: student.id,
        sessionId: structure.currentSessionId,
        classId: section.classId,
        sectionId: section.id,
        shiftId: section.shiftId,
        rollNo: roll,
        enrollmentDate: date(thisYear, 1, 5),
        type: 'NEW',
        status: 'ACTIVE',
      },
    });

    // Students 0 and 1 are the parent account's two children.
    if (i < 2) {
      await prisma.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId: parentGuardian.id,
          relation: 'FATHER',
          isPrimary: true,
          isEmergencyContact: true,
        },
      });
    } else if (i < STUDENT_NAMES.length - 1) {
      // Everyone else gets their own guardian — except the last student, who
      // deliberately has none. "No guardian" is a real edge case and every
      // list, export and notification path should survive it.
      const g = await prisma.guardian.create({
        data: {
          schoolId,
          name: `QA Guardian of ${firstName}`,
          relation: i % 2 === 0 ? 'MOTHER' : 'FATHER',
          phone: bdPhone(i + 10),
        },
      });
      await prisma.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId: g.id,
          relation: i % 2 === 0 ? 'MOTHER' : 'FATHER',
          isPrimary: true,
        },
      });
    }

    created += 1;
  }

  ctx.log(
    `${created} students enrolled in the current session ` +
      `(1 linked to the student login, 2 children on the parent login, 1 with no guardian)`,
  );
}

/* ──────────────────────────── entrypoint ──────────────────────────────── */

export async function seedQaDemoSchool(prisma: PrismaClient): Promise<void> {
  const log = (msg: string): void => console.log(`    · ${msg}`);
  const passwordHash = await argon2.hash(QA_PASSWORD, {
    type: argon2.argon2id,
  });
  const ctx: Ctx = { prisma, schoolId: DEFAULT_SCHOOL_ID, passwordHash, log };

  await purge(ctx);
  const users = await seedAccounts(ctx);
  const structure = await seedStructure(ctx);
  await seedStaff(ctx, users, structure);
  await seedStudents(ctx, users, structure);
}
