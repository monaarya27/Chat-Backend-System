import { randomBytes } from 'node:crypto';
import type {
  LastSeen,
  ListMessagesOptions,
  MarkReadResult,
  Message,
  MessagePage,
  UpdateLastSeenResult,
} from '../../types/domain';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { compareMessagePosition, shouldAdvanceLastSeen, type MessagePosition } from '../../utils/messagePosition';
import type { MessageStore } from '../types';

/**
 * DEVELOPMENT-ONLY MessageStore that keeps messages, read receipts and last-seen
 * pointers in process memory. Used automatically when Firebase credentials are
 * not configured, so every API can be tried locally. Data is lost on restart and
 * is not shared between server instances. Never used in production (config
 * validation requires Firebase when NODE_ENV=production).
 *
 * It follows the same contract as FirestoreMessageStore: ordering by
 * (createdAt, id), cursors, idempotent read receipts, forward-only last seen.
 * Node runs this code on one thread and each method does its check-and-write
 * without awaiting in between, so the operations are atomic like Firestore transactions.
 */

interface StoredMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  readBy: Map<string, Date>;
}

export interface InMemoryMessageStoreOptions {
  /** Clock used for message, receipt and last-seen timestamps. */
  now?: () => Date;
  /** Message id generator (default: random 20-character id like Firestore's). */
  generateId?: () => string;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const firestoreLikeId = (): string =>
  Array.from(randomBytes(20), (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');

const position = (message: StoredMessage): MessagePosition => ({
  timeMicros: message.createdAt.getTime() * 1000,
  messageId: message.id,
});

export class InMemoryMessageStore implements MessageStore {
  private readonly messages = new Map<string, StoredMessage[]>();
  private readonly lastSeen = new Map<string, Map<string, LastSeen>>();
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: InMemoryMessageStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? firestoreLikeId;
  }

  /** Inserts a message with an explicit timestamp (used by createMessage and by tests). */
  protected insert(chatId: string, senderId: string, text: string, createdAt: Date): Message {
    const stored: StoredMessage = { id: this.generateId(), chatId, senderId, text, createdAt, readBy: new Map() };
    const list = this.messages.get(chatId) ?? [];
    list.push(stored);
    list.sort((a, b) => compareMessagePosition(position(a), position(b)));
    this.messages.set(chatId, list);
    return this.toMessage(stored);
  }

  private toMessage(stored: StoredMessage): Message {
    return {
      id: stored.id,
      chatId: stored.chatId,
      senderId: stored.senderId,
      text: stored.text,
      createdAt: new Date(stored.createdAt),
      readBy: [...stored.readBy.entries()]
        .map(([userId, readAt]) => ({ userId, readAt: new Date(readAt) }))
        .sort((a, b) => a.readAt.getTime() - b.readAt.getTime()),
    };
  }

  private find(chatId: string, messageId: string): StoredMessage | undefined {
    return this.messages.get(chatId)?.find((message) => message.id === messageId);
  }

  async createMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    return this.insert(chatId, senderId, text, this.now());
  }

  async getMessage(chatId: string, messageId: string): Promise<Message | null> {
    const stored = this.find(chatId, messageId);
    return stored ? this.toMessage(stored) : null;
  }

  async listMessages(chatId: string, { limit, cursor }: ListMessagesOptions): Promise<MessagePage> {
    const all = this.messages.get(chatId) ?? [];
    let start = 0;
    if (cursor) {
      const index = all.findIndex((message) => message.id === cursor);
      if (index === -1) {
        throw new ValidationError('cursor does not refer to a message in this chat', undefined, 'INVALID_CURSOR');
      }
      start = index + 1;
    }
    const slice = all.slice(start, start + limit + 1);
    const hasMore = slice.length > limit;
    const messages = slice.slice(0, limit).map((message) => this.toMessage(message));
    const last = messages[messages.length - 1];
    return { messages, hasMore, nextCursor: hasMore && last ? last.id : null };
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult> {
    const stored = this.find(chatId, messageId);
    if (!stored) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
    const existing = stored.readBy.get(userId);
    if (existing) return { receipt: { userId, readAt: new Date(existing) }, alreadyRead: true };
    const readAt = this.now();
    stored.readBy.set(userId, readAt);
    return { receipt: { userId, readAt: new Date(readAt) }, alreadyRead: false };
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<UpdateLastSeenResult> {
    const stored = this.find(chatId, messageId);
    if (!stored) throw new NotFoundError('Message not found in this chat', 'MESSAGE_NOT_FOUND');

    const perChat = this.lastSeen.get(chatId) ?? new Map<string, LastSeen>();
    this.lastSeen.set(chatId, perChat);
    const current = perChat.get(userId) ?? null;
    const currentPosition = current
      ? { timeMicros: current.messageCreatedAt.getTime() * 1000, messageId: current.messageId }
      : null;

    if (current && !shouldAdvanceLastSeen(currentPosition, position(stored))) {
      return { lastSeen: structuredClone(current), updated: false };
    }
    const next: LastSeen = { userId, messageId, messageCreatedAt: new Date(stored.createdAt), seenAt: this.now() };
    perChat.set(userId, next);
    return { lastSeen: structuredClone(next), updated: true };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    return [...(this.lastSeen.get(chatId)?.values() ?? [])].map((entry) => structuredClone(entry));
  }
}
