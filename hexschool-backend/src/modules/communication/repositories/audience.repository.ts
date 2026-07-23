import { Injectable } from '@nestjs/common';
import { NoticeAudience, NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface AudienceMember {
  recipientType: 'GUARDIAN' | 'STUDENT' | 'STAFF';
  recipientId: string;
  destination: string;
  name: string;
}

export interface AudienceQuery {
  schoolId: string;
  sessionId: string;
  audience: NoticeAudience;
  /** Class or section id list for CLASS / SECTION audiences. */
  classIds?: string[];
  sectionIds?: string[];
  channel: NotificationChannel;
}

/**
 * Resolves a notice/bulk audience to concrete destinations (roadmap M17
 * §4 "audience resolver: all parents of class 7, …"). A narrow read
 * repository (the M12 `EmployeeDirectoryRepository` precedent — it spans
 * guardians/students/teachers/staff and BaseRepository binds to one model)
 * with only PrismaService, so CommunicationModule stays self-contained and
 * the module graph acyclic.
 *
 * Contact lives on the `user` for students/teachers/staff and directly on
 * the guardian row; a member with no destination for the channel is
 * dropped (you cannot SMS a parent with no phone).
 */
@Injectable()
export class AudienceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(query: AudienceQuery): Promise<AudienceMember[]> {
    const { audience } = query;
    const wantsParents =
      audience === 'ALL' ||
      audience === 'PARENTS' ||
      audience === 'CLASS' ||
      audience === 'SECTION';
    const wantsStudents = audience === 'STUDENTS';
    const wantsTeachers = audience === 'ALL' || audience === 'TEACHERS';
    const wantsStaff = audience === 'ALL' || audience === 'STAFF';

    const members: AudienceMember[] = [];
    if (wantsParents) members.push(...(await this.parents(query)));
    if (wantsStudents) members.push(...(await this.students(query)));
    if (wantsTeachers) members.push(...(await this.teachers(query)));
    if (wantsStaff) members.push(...(await this.staff(query)));

    // Dedupe by destination — a guardian shared by two children, or a
    // teacher who is also a parent, should be counted once.
    const seen = new Set<string>();
    return members.filter((m) => {
      if (seen.has(m.destination)) return false;
      seen.add(m.destination);
      return true;
    });
  }

  /** Just the count + estimated recipients for the composer preview. */
  async count(query: AudienceQuery): Promise<number> {
    return (await this.resolve(query)).length;
  }

  /**
   * ACTIVE students whose birthday (month + day) is today, with their
   * primary guardian's phone — the birthday-wish job's audience. dob is a
   * @db.Date, so the match is a raw EXTRACT (Prisma has no month/day op).
   */
  async birthdaysToday(
    schoolId: string,
    month: number,
    day: number,
  ): Promise<Array<{ studentId: string; name: string; phone: string }>> {
    const students = await this.prisma.$queryRaw<
      Array<{ id: string; first_name: string; last_name: string }>
    >`
      SELECT id, first_name, last_name
      FROM students
      WHERE school_id = ${schoolId}::uuid
        AND deleted_at IS NULL
        AND status = 'ACTIVE'
        AND EXTRACT(MONTH FROM dob) = ${month}
        AND EXTRACT(DAY FROM dob) = ${day}`;
    if (students.length === 0) return [];

    const links = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, isPrimary: true },
      select: { studentId: true, guardian: { select: { phone: true } } },
    });
    const phoneByStudent = new Map(
      links.map((l) => [l.studentId, l.guardian.phone]),
    );

    return students
      .map((s) => ({
        studentId: s.id,
        name: `${s.first_name} ${s.last_name}`.trim(),
        phone: phoneByStudent.get(s.id) ?? '',
      }))
      .filter((s) => s.phone);
  }

  /** Active admin/super-admin user ids — the audience for system alerts. */
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

  private async parents(query: AudienceQuery): Promise<AudienceMember[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId: query.schoolId,
        sessionId: query.sessionId,
        status: 'ACTIVE',
        deletedAt: null,
        ...(query.audience === 'CLASS' && query.classIds?.length
          ? { classId: { in: query.classIds } }
          : {}),
        ...(query.audience === 'SECTION' && query.sectionIds?.length
          ? { sectionId: { in: query.sectionIds } }
          : {}),
      },
      select: { studentId: true },
    });
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    if (studentIds.length === 0) return [];

    const links = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: studentIds }, isPrimary: true },
      select: {
        guardian: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    return links
      .map((l) =>
        this.toMember(
          'GUARDIAN',
          l.guardian.id,
          l.guardian.name,
          query.channel,
          l.guardian.phone,
          l.guardian.email,
        ),
      )
      .filter((m): m is AudienceMember => m !== null);
  }

  private async students(query: AudienceQuery): Promise<AudienceMember[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId: query.schoolId,
        sessionId: query.sessionId,
        status: 'ACTIVE',
        deletedAt: null,
        ...(query.classIds?.length ? { classId: { in: query.classIds } } : {}),
        ...(query.sectionIds?.length
          ? { sectionId: { in: query.sectionIds } }
          : {}),
      },
      select: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            user: { select: { phone: true, email: true } },
          },
        },
      },
    });
    return enrollments
      .map((e) =>
        this.toMember(
          'STUDENT',
          e.student.id,
          `${e.student.firstName} ${e.student.lastName}`.trim(),
          query.channel,
          e.student.user?.phone ?? null,
          e.student.user?.email ?? null,
        ),
      )
      .filter((m): m is AudienceMember => m !== null);
  }

  private async teachers(query: AudienceQuery): Promise<AudienceMember[]> {
    const rows = await this.prisma.teacher.findMany({
      where: { schoolId: query.schoolId, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: { select: { phone: true, email: true } },
      },
    });
    return rows
      .map((t) =>
        this.toMember(
          'STAFF',
          t.id,
          `${t.firstName} ${t.lastName}`.trim(),
          query.channel,
          t.user?.phone ?? null,
          t.user?.email ?? null,
        ),
      )
      .filter((m): m is AudienceMember => m !== null);
  }

  private async staff(query: AudienceQuery): Promise<AudienceMember[]> {
    const rows = await this.prisma.staffProfile.findMany({
      where: { schoolId: query.schoolId, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: { select: { phone: true, email: true } },
      },
    });
    return rows
      .map((s) =>
        this.toMember(
          'STAFF',
          s.id,
          `${s.firstName} ${s.lastName}`.trim(),
          query.channel,
          s.user?.phone ?? null,
          s.user?.email ?? null,
        ),
      )
      .filter((m): m is AudienceMember => m !== null);
  }

  private toMember(
    recipientType: AudienceMember['recipientType'],
    recipientId: string,
    name: string,
    channel: NotificationChannel,
    phone: string | null,
    email: string | null,
  ): AudienceMember | null {
    const destination = channel === 'EMAIL' ? email : phone;
    if (!destination) return null;
    return { recipientType, recipientId, destination, name };
  }
}
