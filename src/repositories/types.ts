import type {
  Chat,
  CreateUserInput,
  LastSeen,
  ListMessagesOptions,
  MarkReadResult,
  Message,
  MessagePage,
  UpdateLastSeenResult,
  User,
} from '../types/domain';

/**
 * Repository interfaces ("ports"). Services depend on these, never on Prisma or
 * Firestore directly. Production wires in the Prisma/Firestore implementations;
 * tests wire in in-memory fakes. This keeps business logic testable and makes it
 * easy to swap a storage technology later.
 */

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findManyByIds(ids: string[]): Promise<User[]>;
  /** @throws UniqueConstraintError if the id or email already exists. */
  create(input: CreateUserInput): Promise<User>;
}

export interface ChatRepository {
  findById(chatId: string): Promise<Chat | null>;
  findByDirectKey(directKey: string): Promise<Chat | null>;
  /**
   * Atomically creates the chat row and both member rows.
   * @throws UniqueConstraintError if a chat with this directKey already exists.
   */
  createDirectChat(directKey: string, memberIds: [string, string]): Promise<Chat>;
  /** Chats the user belongs to, most recently updated first. */
  listForUser(userId: string): Promise<Chat[]>;
  /** Bumps `updatedAt` (called when a new message is sent). */
  touch(chatId: string): Promise<void>;
}

export interface MessageStore {
  createMessage(chatId: string, senderId: string, text: string): Promise<Message>;
  getMessage(chatId: string, messageId: string): Promise<Message | null>;
  /**
   * Messages in ascending timestamp order, starting after `cursor`.
   * @throws ValidationError if the cursor does not refer to a message in this chat.
   */
  listMessages(chatId: string, options: ListMessagesOptions): Promise<MessagePage>;
  /**
   * Records that `userId` read the message. Idempotent: a second call keeps the
   * original read time and returns `alreadyRead: true`.
   * @throws NotFoundError if the message does not exist.
   */
  markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult>;
  /**
   * Moves the user's last-seen pointer to `messageId` unless that would move it backwards.
   * @throws NotFoundError if the message does not exist in this chat.
   */
  updateLastSeen(chatId: string, userId: string, messageId: string): Promise<UpdateLastSeenResult>;
  listLastSeen(chatId: string): Promise<LastSeen[]>;
}

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}
