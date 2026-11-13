/**
 * In-memory implementations of the repository interfaces.
 *
 * The user/chat fakes behave like the real PostgreSQL implementations at the contract
 * level (unique constraints, ordering, cursors, idempotent reads, monotonic
 * last-seen) so API tests exercise the real services, controllers, validation
 * and error handling without needing a database.
 */
import type { ChatRepository, UserRepository } from '../../src/repositories/types';
import type { Chat, CreateUserInput, Message, User } from '../../src/types/domain';
import { InMemoryMessageStore as RealInMemoryMessageStore } from '../../src/repositories/memory/inMemoryMessageStore';
import { UniqueConstraintError } from '../../src/utils/errors';

/** Deterministic clock: every call returns a time 1 second later than the previous. */
export class FakeClock {
  private current = Date.parse('2026-01-01T00:00:00.000Z');
  now(): Date {
    this.current += 1000;
    return new Date(this.current);
  }
}

/** Yields to the event loop so concurrent requests can interleave like real I/O. */
const io = () => new Promise<void>((resolve) => setImmediate(resolve));

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  constructor(private readonly clock: FakeClock) {}

  async findById(id: string): Promise<User | null> {
    await io();
    const user = this.users.get(id);
    return user ? clone(user) : null;
  }

  async findManyByIds(ids: string[]): Promise<User[]> {
    await io();
    return ids.flatMap((id) => {
      const user = this.users.get(id);
      return user ? [clone(user)] : [];
    });
  }

  async create(input: CreateUserInput): Promise<User> {
    await io();
    if (this.users.has(input.id)) throw new UniqueConstraintError(['id']);
    if ([...this.users.values()].some((user) => user.email === input.email)) {
      throw new UniqueConstraintError(['email']);
    }
    const now = this.clock.now();
    const user: User = { ...input, createdAt: now, updatedAt: now };
    this.users.set(user.id, user);
    return clone(user);
  }
}

export class InMemoryChatRepository implements ChatRepository {
  readonly chats = new Map<string, Chat & { directKey: string }>();
  private nextId = 1;
  constructor(private readonly clock: FakeClock) {}

  private strip(chat: Chat & { directKey: string }): Chat {
    const { directKey: _directKey, ...rest } = clone(chat);
    return rest;
  }

  async findById(chatId: string): Promise<Chat | null> {
    await io();
    const chat = this.chats.get(chatId);
    return chat ? this.strip(chat) : null;
  }

  async findByDirectKey(directKey: string): Promise<Chat | null> {
    await io();
    const chat = [...this.chats.values()].find((c) => c.directKey === directKey);
    return chat ? this.strip(chat) : null;
  }

  async createDirectChat(directKey: string, memberIds: [string, string]): Promise<Chat> {
    await io();
    // Emulates PostgreSQL's UNIQUE index on direct_key.
    if ([...this.chats.values()].some((c) => c.directKey === directKey)) {
      throw new UniqueConstraintError(['direct_key']);
    }
    const now = this.clock.now();
    const chat = {
      id: `chat-${String(this.nextId++).padStart(4, '0')}`,
      directKey,
      createdAt: now,
      updatedAt: now,
      members: memberIds.map((userId) => ({ userId, joinedAt: now })),
    };
    this.chats.set(chat.id, chat);
    return this.strip(chat);
  }

  async listForUser(userId: string): Promise<Chat[]> {
    await io();
    return [...this.chats.values()]
      .filter((chat) => chat.members.some((m) => m.userId === userId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
      .map((chat) => this.strip(chat));
  }

  async touch(chatId: string): Promise<void> {
    await io();
    const chat = this.chats.get(chatId);
    if (chat) chat.updatedAt = this.clock.now();
  }
}

/**
 * The production in-memory message store, with a deterministic clock and
 * sequential ids so tests are repeatable, plus a helper to insert messages
 * with explicit timestamps.
 */
export class InMemoryMessageStore extends RealInMemoryMessageStore {
  constructor(clock: FakeClock) {
    let next = 1;
    super({ now: () => clock.now(), generateId: () => `msg-${String(next++).padStart(4, '0')}` });
  }

  seed(chatId: string, senderId: string, text: string, createdAt: Date): Message {
    return this.insert(chatId, senderId, text, createdAt);
  }
}
