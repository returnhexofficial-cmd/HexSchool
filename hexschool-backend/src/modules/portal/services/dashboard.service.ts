import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '../../../database/redis/redis-cache.service';
import { SessionsService } from '../../academic/services/sessions.service';
import { NoticesRepository } from '../../communication/repositories/notices.repository';
import { DashboardRepository } from '../repositories/dashboard.repository';

const ADMIN_TTL = 300; // 5 min
const ACCOUNTANT_TTL = 300;

/**
 * Assembles the admin and accountant dashboards (roadmap M18 §4) from the
 * narrow `DashboardRepository`, cached in Redis for a few minutes so the
 * landing page is cheap. Redis being down degrades to a live compute (the
 * cache is best-effort), so a dashboard never depends on the cache.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly notices: NoticesRepository,
    private readonly sessions: SessionsService,
    private readonly cache: RedisCacheService,
  ) {}

  async admin(schoolId: string) {
    const key = `dashboard:admin:${schoolId}`;
    const cached = await this.cache.getJson<Record<string, unknown>>(key);
    if (cached) return { ...cached, cached: true };

    const session = await this.sessions.getCurrent(schoolId);
    const [
      students,
      todayAttendance,
      teacherAttendance,
      feeCollection,
      pendingAdmissions,
      recentNotices,
      upcomingEvents,
      resultStats,
    ] = await Promise.all([
      this.repo.studentTotals(schoolId, session?.id ?? null),
      this.repo.todayAttendance(schoolId),
      this.repo.teacherAttendanceToday(schoolId),
      this.repo.feeCollection(schoolId),
      this.repo.pendingAdmissions(schoolId),
      this.notices.publishedFeed(schoolId, { take: 5 }),
      this.repo.upcomingEvents(schoolId),
      this.repo.latestResultStats(schoolId),
    ]);

    const payload = {
      session: session ? { id: session.id, name: session.name } : null,
      students,
      todayAttendance,
      teacherAttendance,
      feeCollection,
      pendingAdmissions,
      recentNotices: recentNotices.map((n) => ({
        id: n.id,
        title: n.title,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
      upcomingEvents,
      resultStats,
      computedAt: new Date().toISOString(),
    };
    await this.cache.setJson(key, payload, ADMIN_TTL);
    return { ...payload, cached: false };
  }

  async accountant(schoolId: string) {
    const key = `dashboard:accountant:${schoolId}`;
    const cached = await this.cache.getJson<Record<string, unknown>>(key);
    if (cached) return { ...cached, cached: true };

    const [feeCollection, byMethod, pendingInvoices, trend] = await Promise.all(
      [
        this.repo.feeCollection(schoolId),
        this.repo.collectionByMethod(schoolId),
        this.repo.pendingInvoices(schoolId),
        this.repo.monthlyCollectionTrend(schoolId, 6),
      ],
    );

    const payload = {
      feeCollection,
      collectionByMethod: byMethod,
      pendingInvoices,
      monthlyTrend: trend,
      computedAt: new Date().toISOString(),
    };
    await this.cache.setJson(key, payload, ACCOUNTANT_TTL);
    return { ...payload, cached: false };
  }
}
