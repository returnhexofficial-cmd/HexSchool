import { Injectable } from '@nestjs/common';
import { Notification } from '@prisma/client';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NotificationsRepository } from '../repositories/notifications.repository';

export interface InboxResult {
  items: Notification[];
  unread: number;
}

/**
 * In-app notification inbox (roadmap M17 §4 "GET /notifications + unread
 * badge (polling now; SSE/WebSocket in Phase 3)"). Keyed on the logged-in
 * user id: any IN_APP row addressed to `recipient_id = userId` is theirs,
 * whatever the recipient_type. Portal mapping of a guardian/student to
 * their profile inbox is an M18 concern.
 */
@Injectable()
export class InboxService {
  constructor(private readonly notifications: NotificationsRepository) {}

  async list(
    actor: AccessTokenPayload,
    onlyUnread = false,
  ): Promise<InboxResult> {
    const items = await this.notifications.inboxForUser(
      actor.schoolId,
      actor.sub,
      onlyUnread,
      50,
    );
    const unread = await this.notifications.countUnreadForUser(
      actor.schoolId,
      actor.sub,
    );
    return { items, unread };
  }

  markRead(actor: AccessTokenPayload, ids?: string[]): Promise<number> {
    return this.notifications.markReadForUser(actor.schoolId, actor.sub, ids);
  }
}
