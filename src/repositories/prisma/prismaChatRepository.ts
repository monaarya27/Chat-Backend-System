import type { PrismaClient } from '@prisma/client';
import type { Chat } from '../../types/domain';
import type { ChatRepository } from '../types';
import { withPrismaErrors } from './prismaErrors';

/** Shape selected from PostgreSQL for every chat query. */
const chatSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: { userId: true, joinedAt: true },
    orderBy: { joinedAt: 'asc' },
  },
} as const;

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(chatId: string): Promise<Chat | null> {
    return withPrismaErrors(() =>
      this.prisma.chat.findUnique({ where: { id: chatId }, select: chatSelect }),
    );
  }

  findByDirectKey(directKey: string): Promise<Chat | null> {
    return withPrismaErrors(() =>
      this.prisma.chat.findUnique({ where: { directKey }, select: chatSelect }),
    );
  }

  createDirectChat(directKey: string, memberIds: [string, string]): Promise<Chat> {
    // A nested create runs in a single transaction: chat + both members, or nothing.
    // If another request created the same pair first, PostgreSQL rejects this insert
    // via the UNIQUE index on direct_key (translated to UniqueConstraintError).
    return withPrismaErrors(() =>
      this.prisma.chat.create({
        data: {
          directKey,
          members: { create: memberIds.map((userId) => ({ userId })) },
        },
        select: chatSelect,
      }),
    );
  }

  listForUser(userId: string): Promise<Chat[]> {
    return withPrismaErrors(() =>
      this.prisma.chat.findMany({
        where: { members: { some: { userId } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: chatSelect,
      }),
    );
  }

  async touch(chatId: string): Promise<void> {
    await withPrismaErrors(() =>
      this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
    );
  }
}
