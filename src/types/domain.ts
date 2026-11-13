/**
 * Domain types shared by services, repositories and controllers.
 * They are independent of Prisma and Firestore so the business logic does not
 * depend on any particular database SDK.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  id: string;
  name: string;
  email: string;
}

export interface ChatMember {
  userId: string;
  joinedAt: Date;
}

export interface Chat {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  members: ChatMember[];
}

export interface ReadReceipt {
  userId: string;
  readAt: Date;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  readBy: ReadReceipt[];
}

export interface MessagePage {
  messages: Message[];
  /** Pass this as `cursor` to fetch the next page; null when there is nothing more. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListMessagesOptions {
  limit: number;
  /** Id of the last message the client already has. Results start strictly after it. */
  cursor?: string | undefined;
}

export interface LastSeen {
  userId: string;
  messageId: string;
  messageCreatedAt: Date;
  seenAt: Date;
}

export interface MarkReadResult {
  receipt: ReadReceipt;
  /** True when the user had already read the message (idempotent call). */
  alreadyRead: boolean;
}

export interface UpdateLastSeenResult {
  lastSeen: LastSeen;
  /** False when the request was ignored because it would move last-seen backwards. */
  updated: boolean;
}
