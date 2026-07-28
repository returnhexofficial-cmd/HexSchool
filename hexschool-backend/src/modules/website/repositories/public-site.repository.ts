import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The read side of everything the public site borrows from other modules:
 * the notice board (M17), public calendar events (M05), the teacher
 * directory (M08), the headline counters, and the single row a student
 * verification may reveal (M09/M11).
 *
 * Why a repository here rather than importing five feature modules: every
 * one of these reads is **privacy-shaped**. The teacher directory must not
 * be able to return a phone number, and the verification lookup must not
 * be able to return a birth-certificate number — so the SELECT list is the
 * privacy policy, and it belongs in one auditable place rather than being
 * trimmed after the fact from a general-purpose service's richer result.
 * (The `AudienceRepository` (M17) and `DashboardRepository` (M18)
 * precedent: a narrow cross-module read repository over PrismaService,
 * services still never touch Prisma.)
 */
@Injectable()
export class PublicSiteRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Published, website-visible notices — pinned first, then newest. */
  async websiteNotices(
    schoolId: string,
    opts: { skip?: number; take?: number; search?: string } = {},
  ) {
    const where = {
      schoolId,
      deletedAt: null,
      isPublished: true,
      isWebsiteVisible: true,
      ...(opts.search
        ? { title: { contains: opts.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notice.findMany({
        where,
        select: {
          id: true,
          title: true,
          body: true,
          attachmentUrls: true,
          pinned: true,
          publishAt: true,
          createdAt: true,
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 20,
      }),
      this.prisma.notice.count({ where }),
    ]);
    return { items, total };
  }

  /** One website-visible notice (the detail page). */
  websiteNotice(schoolId: string, id: string) {
    return this.prisma.notice.findFirst({
      where: {
        id,
        schoolId,
        deletedAt: null,
        isPublished: true,
        isWebsiteVisible: true,
      },
      select: {
        id: true,
        title: true,
        body: true,
        attachmentUrls: true,
        pinned: true,
        publishAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Calendar events flagged `is_public` (the flag M05 added for exactly
   * this module), from `from` onward.
   */
  publicEvents(schoolId: string, from: Date, take = 20) {
    return this.prisma.calendarEvent.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isPublic: true,
        endDate: { gte: from },
      },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { startDate: 'asc' },
      take,
    });
  }

  /**
   * The teacher directory. ACTIVE teachers only, and the SELECT list is
   * the privacy contract (roadmap §6): name, designation, photo and a
   * qualifications summary — never phone, email, NID or address.
   */
  async teacherDirectory(schoolId: string) {
    const teachers = await this.prisma.teacher.findMany({
      where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        specialization: true,
        photoUrl: true,
        joiningDate: true,
        // `teacher_qualifications` has no soft delete (M08).
        qualifications: {
          select: { degree: true, institution: true, passingYear: true },
          orderBy: { passingYear: 'desc' },
        },
        // `teacher_subjects` is a join table with no soft delete (M08).
        subjects: {
          select: { subject: { select: { name: true } } },
        },
      },
      orderBy: [{ designation: 'asc' }, { firstName: 'asc' }],
    });
    return teachers;
  }

  /** Headline counters for the home page (roadmap §5 "stats"). */
  async headlineStats(schoolId: string, sessionId: string | null) {
    const [students, teachers, staff, classes] = await Promise.all([
      sessionId
        ? this.prisma.enrollment.count({
            where: {
              schoolId,
              sessionId,
              deletedAt: null,
              status: 'ACTIVE',
            },
          })
        : this.prisma.student.count({
            where: { schoolId, deletedAt: null, status: 'ACTIVE' },
          }),
      this.prisma.teacher.count({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.staffProfile.count({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.schoolClass.count({ where: { schoolId, deletedAt: null } }),
    ]);
    return { students, teachers, staff, classes };
  }

  /**
   * A student verification lookup by permanent UID or rotatable QR token.
   * Returns at most the four fields the roadmap allows (§4 "name, class,
   * status, photo — privacy-limited"); the service then filters that down
   * further to whatever `website.student_verification_fields` permits.
   *
   * Deliberately NOT returned: date of birth, guardians, contacts,
   * documents, medical info, fees — none of which a stranger with a roll
   * number is entitled to.
   */
  async verifyStudent(schoolId: string, identifier: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        OR: [{ studentUid: identifier }, { qrToken: identifier }],
      },
      select: {
        id: true,
        studentUid: true,
        firstName: true,
        lastName: true,
        status: true,
        photoUrl: true,
      },
    });
    if (!student) return null;

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { schoolId, studentId: student.id, deletedAt: null },
      select: {
        rollNo: true,
        status: true,
        class: { select: { name: true } },
        section: { select: { name: true } },
        session: { select: { name: true, isCurrent: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return { student, enrollment };
  }

  /**
   * Active admin/super-admin user ids — who a contact-form message or a
   * career application lands with in the in-app inbox. (The same query
   * `AudienceRepository.adminUserIds` runs for M17's system alerts; it is
   * repeated here rather than importing CommunicationModule's private
   * repository, which is not exported.)
   */
  async adminUserIds(schoolId: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        userType: { in: ['SUPER_ADMIN', 'ADMIN'] },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The school's current session (the stats denominator). */
  currentSessionId(schoolId: string): Promise<{ id: string } | null> {
    return this.prisma.academicSession.findFirst({
      where: { schoolId, deletedAt: null, isCurrent: true },
      select: { id: true },
    });
  }
}
