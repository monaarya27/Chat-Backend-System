import type { ChatRepository, MessageStore } from '../repositories/types';
import type {
  LastSeen,
  MarkReadResult,
  Message,
  MessagePage,
  UpdateLastSeenResult,
} from '../types/domain';
import { NotFoundError, ValidationError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { assertActingAsSelf } from './authorization';
import type { ChatService } from './chatService';

export class MessageService {
  constructor(
    private readonly chatService: ChatService,
    private readonly chats: ChatRepository,
    private readonly store: MessageStore,
    private readonly logger: Logger,
  ) {}

  /** API 2: stores a new message in Firestore and bumps the chat's updatedAt in PostgreSQL. */
  async send(actorId: string, chatId: string, senderId: string, text: string): Promise<Message> {
    assertActingAsSelf(actorId, senderId, 'senderId');
    await this.chatService.requireMembership(chatId, senderId);

    const message = await this.store.createMessage(chatId, senderId, text);

    // The message is already safely stored. Failing to bump the chat's sort
    // position should not turn a successful send into an error for the client,
    // so we log it instead of throwing.
    try {
      await this.chats.touch(chatId);
    } catch (error) {
      this.logger.warn({ err: error, chatId }, 'Could not update chat updatedAt after sending message');
    }
    return message;
  }

  /** API 3: paginated messages, oldest first. */
  async list(actorId: string, chatId: string, limit: number, cursor?: string): Promise<MessagePage> {
    await this.chatService.requireMembership(chatId, actorId);
    return this.store.listMessages(chatId, { limit, cursor });
  }

  /** API 4: records a read receipt (idempotent). */
  async markRead(actorId: string, chatId: string, messageId: string, userId: string): Promise<MarkReadResult> {
    assertActingAsSelf(actorId, userId, 'userId');
    await this.chatService.requireMembership(chatId, userId);

    const message = await this.requireMessage(chatId, messageId);
    if (message.senderId === userId) {
      throw new ValidationError('You cannot mark your own message as read', undefined, 'OWN_MESSAGE');
    }
    return this.store.markRead(chatId, messageId, userId);
  }

  /** API 5: moves the user's last-seen pointer forward (never backwards). */
  async updateLastSeen(
    actorId: string,
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<UpdateLastSeenResult> {
    assertActingAsSelf(actorId, userId, 'userId');
    await this.chatService.requireMembership(chatId, userId);
    return this.store.updateLastSeen(chatId, userId, messageId);
  }

  /** Last-seen pointers of all members (handy for showing "seen" indicators). */
  async listLastSeen(actorId: string, chatId: string): Promise<LastSeen[]> {
    await this.chatService.requireMembership(chatId, actorId);
    return this.store.listLastSeen(chatId);
  }

  private async requireMessage(chatId: string, messageId: string): Promise<Message> {
    const message = await this.store.getMessage(chatId, messageId);
    if (!message) throw new NotFoundError('Message not found in this chat', 'MESSAGE_NOT_FOUND');
    return message;
  }
}
