import type { ChatRepository, UserRepository } from '../repositories/types';
import type { Chat } from '../types/domain';
import { buildDirectKey } from '../utils/directKey';
import {
  ForbiddenError,
  NotFoundError,
  UniqueConstraintError,
  ValidationError,
} from '../utils/errors';

export interface CreateChatResult {
  chat: Chat;
  /** true = a new chat was created, false = an existing chat was returned. */
  created: boolean;
}

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly users: UserRepository,
  ) {}

  /**
   * API 1: returns the one-to-one chat between two users, creating it if needed.
   *
   * Duplicate prevention works in two layers:
   *  1. Look up the chat by its canonical direct key (fast path).
   *  2. If not found, insert it. If a concurrent request inserted the same pair
   *     in the meantime, PostgreSQL's UNIQUE index rejects our insert and we simply
   *     return the chat the other request created.
   */
  async createOrGetDirectChat(actorId: string, userAId: string, userBId: string): Promise<CreateChatResult> {
    if (userAId === userBId) {
      throw new ValidationError('userAId and userBId must be different users', undefined, 'SAME_USER');
    }
    if (actorId !== userAId && actorId !== userBId) {
      throw new ForbiddenError('You can only create chats that include yourself', 'NOT_A_PARTICIPANT');
    }

    const found = await this.users.findManyByIds([userAId, userBId]);
    const foundIds = new Set(found.map((user) => user.id));
    const missing = [userAId, userBId].filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(`User(s) not found: ${missing.join(', ')}`, 'USER_NOT_FOUND', { missing });
    }

    const directKey = buildDirectKey(userAId, userBId);
    const existing = await this.chats.findByDirectKey(directKey);
    if (existing) return { chat: existing, created: false };

    try {
      const chat = await this.chats.createDirectChat(directKey, [userAId, userBId]);
      return { chat, created: true };
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      // Lost the race: another request created this chat first. Return theirs.
      const winner = await this.chats.findByDirectKey(directKey);
      if (!winner) throw error;
      return { chat: winner, created: false };
    }
  }

  /**
   * Loads a chat and ensures `userId` is a member.
   * 404 if the chat does not exist, 403 if the user is not a member.
   */
  async requireMembership(chatId: string, userId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw new NotFoundError(`Chat ${chatId} not found`, 'CHAT_NOT_FOUND');
    if (!chat.members.some((member) => member.userId === userId)) {
      throw new ForbiddenError('User is not a member of this chat', 'NOT_A_CHAT_MEMBER');
    }
    return chat;
  }
}
