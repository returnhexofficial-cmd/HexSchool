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
  const { prisma, schoolId } = ctx;

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

  /*
   * Purge **every** student in the QA school, not just the seed's own
   * `QA-<year>-<n>` uids.
   *
   * A QA round can *admit* an applicant through the M10 wizard, and that
   * student gets the school's real id pattern (`HEX-202600001`) — so a prefix
   * match misses it and one orphan survives every reseed, accumulating run
   * after run and breaking any test that asserts the seeded head-count. The
   * admission application cascades away with the session, which makes the
   * leftover invisible: no application, no enrolment, just a stray row.
   *
   * Matching on the admission class does not rescue it either, because
   * deleting the QA classes nulls `admission_class_id` first — the reference
   * that would identify it is gone by the time we look.
   *
   * The same shape as findings F7 and F12: cleanup keyed on a marker the
   * production code never applies. So scope by **ownership** instead — this
   * seeder owns the demo school outright, and `guard.ts` already makes it
   * impossible to run anywhere but a local database.
   *
   * F26: the first version of this fix only converted `students`, and left the
   * row below it matching `guardians` on a `'QA '` name prefix. A guardian
   * created by the *application* — by admitting an applicant, or by importing
   * a spreadsheet — is named by whoever filled the form, so it survived every
   * reseed. That one is worse than a stray student, because guardian **phone**
   * is the dedup key: a leftover row makes the next run's sibling-dedup check
   * pass without proving anything.
   *
   * So the whole block is scoped by `schoolId` now, not just the part that had
   * already bitten. Every table here carries one (the global rule), and the
   * application can create rows in all of them during a QA round.
   */
  await prisma.studentGuardian.deleteMany({
    where: { student: { schoolId } },
  });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  /**
   * F12, finally. `staff_attendances` is polymorphic — `person_type` +
   * `person_id` with **no foreign key**, the M08 decision that keeps the two
   * employee lifecycles independent. Nothing cascades, so deleting teachers and
   * staff leaves their attendance behind: the QA database had accumulated **92
   * orphaned rows** dating back to 2026-07-02, pointing at people who no longer
   * existed, and they surfaced as phantom LEAVE on the staff sheet.
   *
   * It has to be deleted explicitly, and *before* the employees, while the rows
   * are still attributable.
   */
  await prisma.staffAttendance.deleteMany({ where: { schoolId } });
  // Generated *by* QA rounds rather than seeded: notifications raised while
  // driving flows, and analytics collected from visiting the public site.
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.siteAnalyticsDaily.deleteMany({ where: { schoolId } });
  await prisma.teacher.deleteMany({ where: { schoolId } });
  await prisma.staffProfile.deleteMany({ where: { schoolId } });

  await prisma.section.deleteMany({ where: { schoolId } });
  await prisma.schoolClass.deleteMany({ where: { schoolId } });
  await prisma.subject.deleteMany({ where: { schoolId } });
  await prisma.department.deleteMany({ where: { schoolId } });
  // Bell schedules hang off the shift with a plain FK, so they must go first
  // or the shift delete fails. Timetables and their entries cascade from the
  // academic session above; period slots do not, because a shift outlives a
  // session.
  await prisma.periodSlot.deleteMany({ where: { schoolId } });
  await prisma.shift.deleteMany({ where: { schoolId } });

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
  /** Same shape as `sectionIds`, for the COMPLETED session. */
  previousSectionIds: string[];
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

  /**
   * The bell schedule the shift runs on.
   *
   * M13 refuses to build a routine without one — correctly, and with a good
   * empty state saying so. But every reseed then leaves a QA round having to
   * hand-build five periods before it can reach the routine builder at all,
   * and M12's period-mode marking is unreachable for the same reason
   * (QA finding F32).
   *
   * Four teaching periods around a tiffin break, inside the 07:30–12:30
   * window, contiguous so the "starts where the last one ended" default has
   * something sensible to offer.
   */
  const bellSchedule: Array<[name: string, start: string, end: string, type: string]> = [
    ['Period 1', '07:30', '08:15', 'CLASS'],
    ['Period 2', '08:15', '09:00', 'CLASS'],
    ['Tiffin', '09:00', '09:20', 'BREAK'],
    ['Period 3', '09:20', '10:05', 'CLASS'],
    ['Period 4', '10:05', '10:50', 'CLASS'],
  ];
  for (const [order, [name, start, end, type]] of bellSchedule.entries()) {
    await prisma.periodSlot.create({
      data: {
        schoolId,
        shiftId: shift.id,
        name,
        startTime: new Date(`1970-01-01T${start}:00Z`),
        endTime: new Date(`1970-01-01T${end}:00Z`),
        type: type as 'CLASS' | 'BREAK' | 'ASSEMBLY',
        displayOrder: order + 1,
      },
    });
  }

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
  const previousSectionIds: string[] = [];

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
        else previousSectionIds.push(section.id);
      }

      // Map the curriculum onto the class for this session. Without this the
      // class has subjects in the master list but none *taught*, and the M08
      // assignment matrix correctly refuses with "no subjects mapped for this
      // session" — which also blocks the timetable (M13), exams (M14) and
      // marks (M15). The mapping is the spine those modules hang off.
      for (const [order, subject] of subjects.entries()) {
        await prisma.classSubject.create({
          data: {
            schoolId,
            classId: cls.id,
            subjectId: subject.id,
            sessionId,
            // Science is the optional 4th subject: NCTB grading adds only the
            // points above the bonus base for an optional subject and never
            // lets it join the divisor, so QA needs one to exercise that path.
            isOptional: subject.code === 'QA-SCI',
            fullMarksDefault: 100,
            displayOrder: order,
          },
        });
      }
    }
  }

  // An OPEN admission cycle on the current session. Without one the public
  // admission wizard (M10) reaches step 2 and stops: there is nothing to apply
  // *to*, so the whole admission → enrollment chain is unreachable. The window
  // straddles today so the cycle is genuinely open whenever QA runs.
  const now = new Date();
  const cycle = await prisma.admissionCycle.create({
    data: {
      schoolId,
      sessionId: current.id,
      name: `QA Admission ${thisYear}`,
      startAt: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
      endAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
      testRequired: false,
      status: 'OPEN',
      instructions: 'QA fixture cycle — apply with any BD mobile number.',
    },
  });

  // A cycle carries its own class list with seats and an application fee, and
  // the public wizard's class picker reads *that*, not the school's class
  // master. Without these rows the applicant reaches step 2 with an empty
  // dropdown and cannot proceed.
  for (const classId of classIds) {
    await prisma.admissionCycleClass.create({
      data: { cycleId: cycle.id, classId, seats: 30, applicationFee: 500 },
    });
  }

  const mappings = classIds.length * 2 * subjects.length;
  ctx.log(
    `2 sessions (${current.name} current, ${previous.name} completed), ` +
      `${classIds.length} classes, ${sectionIds.length} current-session sections, ` +
      `${subjects.length} subjects, ${bellSchedule.length} period slots, ` +
      `${mappings} class-subject mappings ` +
      `(1 optional), 1 OPEN admission cycle over ${classIds.length} classes`,
  );

  return {
    currentSessionId: current.id,
    previousSessionId: previous.id,
    classIds,
    sectionIds,
    previousSectionIds,
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

  /**
   * The M08 assignment matrix — who teaches which subject in which section.
   *
   * Without it the M13 routine builder's teacher picker is **empty** and no
   * cell can be completed: it lists teachers holding a duty this session, so
   * that a substitute can be chosen and the assigned one ★-marked. Zero
   * assignments, zero options (QA finding F32).
   *
   * It also feeds the M08 workload report and the conflict checker's notion of
   * whether a placement is an override, so seeding it makes three modules
   * testable rather than one.
   *
   * The two teachers split the curriculum: the first takes Mathematics and
   * Science across every section, the second Bangla and English. That gives
   * the conflict checker something real to catch — one teacher genuinely
   * cannot be in two sections at once.
   */
  const teachers = await prisma.teacher.findMany({
    where: { schoolId },
    orderBy: { employeeId: 'asc' },
    select: { id: true },
  });
  const subjects = await prisma.subject.findMany({
    where: { schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  let assignments = 0;
  for (const section of structure.sectionIds) {
    for (const [index, subject] of subjects.entries()) {
      const teacher = teachers[index % teachers.length];
      if (!teacher) continue;
      await prisma.teacherSectionSubject.create({
        data: {
          schoolId,
          sessionId: structure.currentSessionId,
          teacherId: teacher.id,
          sectionId: section,
          subjectId: subject.id,
        },
      });
      assignments += 1;
    }
  }

  ctx.log(
    `${staffDesignations.length} staff profiles, ${teacherKeys.length} teachers, ` +
      `${assignments} subject assignments`,
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
        type: i % 6 === 0 ? 'NEW' : 'PROMOTED',
        status: 'ACTIVE',
      },
    });

    /**
     * …and a matching enrolment in the **COMPLETED** session.
     *
     * Without this the previous year has sections but nobody in them, and two
     * rules that only this data can reach go untested:
     *
     *  - *COMPLETED sessions are read-only* — the M05 rule that M12 enforces
     *    for the first time. With no enrolment there is nothing to try to mark,
     *    so the guard cannot be exercised at all (QA finding F27).
     *  - *session scoping* — the switcher is only meaningful when the two
     *    sessions hold **different** rosters. The structure seeder already
     *    creates both years' sections saying that is "what makes the
     *    session-scoping sweep meaningful"; it was one table short.
     *
     * A student who was PROMOTED into this year sat in the same section of the
     * year before, which is also the shape journey J6 (year rollover) needs.
     */
    const previousSection = await prisma.section.findUniqueOrThrow({
      where: { id: structure.previousSectionIds[i % structure.previousSectionIds.length] },
      select: { id: true, classId: true, shiftId: true },
    });
    await prisma.enrollment.create({
      data: {
        schoolId,
        studentId: student.id,
        sessionId: structure.previousSessionId,
        classId: previousSection.classId,
        sectionId: previousSection.id,
        shiftId: previousSection.shiftId,
        rollNo: roll,
        enrollmentDate: date(thisYear - 1, 1, 5),
        type: 'NEW',
        // What `PromotionService.closeEnrollment` actually writes to the
        // source row — not COMPLETED. Seeding the status the product would
        // have produced is the difference between a fixture and a guess.
        status: 'PROMOTED',
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
    `${created} students, enrolled in **both** sessions ` +
      `(1 linked to the student login, 2 children on the parent login, 1 with no guardian)`,
  );
}

/* ──────────────────────────── entrypoint ──────────────────────────────── */

/**
 * Tables the purge is *expected* to leave alone: reference data owned by the
 * bootstrap seeders, not by QA. Everything else that still holds a row for the
 * demo school after a purge is a leak.
 */
const REFERENCE_MODELS = new Set([
  'School',
  'Permission',
  'Role',
  'RolePermission',
  'SettingDefinition',
  'Setting',
  'GradingSystem',
  'GradeScale',
  'Account',
  'AuditLog',
  'Sequence',
  'NotificationTemplate',
  // Bootstrap-owned per-school reference data, created by `npm run seed`:
  'SchoolSetting',
  'Group',
  'LeaveType',
  // Sequence counters are deliberately never reset — a student UID is
  // permanent and must never be reissued (M09).
  'DocumentSequence',
  // Counted separately below, because one bootstrap super admin is expected
  // to survive while any *other* leftover user is finding F7 all over again.
  'User',
]);

/**
 * After purging, report anything still owned by the demo school.
 *
 * Five findings in this campaign have been the same bug — a fixture deleted by
 * a marker the production code never applies (**F7** users, **F12**
 * `staff_attendances`, **F23** students, **F26** guardians, and the rest of
 * that purge block). Each was found by accident, several passes apart, and
 * F12 sat open long enough to accumulate 92 orphaned rows pointing at people
 * who no longer existed.
 *
 * Finding them one at a time does not scale. This walks every model that
 * carries a `schoolId` and counts what survived, so the *seed* reports a leak
 * the moment it appears rather than leaving it for a QA round to trip over.
 * It warns rather than throws: a leak makes the fixture untrustworthy, but
 * refusing to seed would leave the tester with no environment at all.
 */
async function reportResidue(ctx: Ctx): Promise<void> {
  const { prisma, schoolId } = ctx;
  const models = Prisma.dmmf.datamodel.models.filter(
    (model) =>
      !REFERENCE_MODELS.has(model.name) &&
      model.fields.some((field) => field.name === 'schoolId'),
  );

  const leaks: string[] = [];

  // Everyone except the bootstrap super admin, who is meant to outlive a purge.
  const strayUsers = await prisma.user.count({
    where: { schoolId, email: { not: 'admin@hexschool.local' } },
  });
  if (strayUsers > 0) leaks.push(`users=${strayUsers}`);

  for (const model of models) {
    const delegate = (prisma as unknown as Record<string, {
      count(args: { where: { schoolId: string } }): Promise<number>;
    }>)[model.name.charAt(0).toLowerCase() + model.name.slice(1)];
    if (!delegate?.count) continue;
    const count = await delegate.count({ where: { schoolId } });
    if (count > 0) leaks.push(`${model.dbName ?? model.name}=${count}`);
  }

  if (leaks.length > 0) {
    ctx.log(
      `⚠ purge left ${leaks.length} table(s) holding rows for this school: ` +
        `${leaks.join(', ')}. Nothing here should survive a purge — each is a ` +
        `fixture keyed on something the app can overwrite. See finding F12.`,
    );
  }
}

export async function seedQaDemoSchool(prisma: PrismaClient): Promise<void> {
  const log = (msg: string): void => console.log(`    · ${msg}`);
  const passwordHash = await argon2.hash(QA_PASSWORD, {
    type: argon2.argon2id,
  });
  const ctx: Ctx = { prisma, schoolId: DEFAULT_SCHOOL_ID, passwordHash, log };

  await purge(ctx);
  await reportResidue(ctx);
  const users = await seedAccounts(ctx);
  const structure = await seedStructure(ctx);
  await seedStaff(ctx, users, structure);
  await seedStudents(ctx, users, structure);
}
