import type { Chat, LastSeen, Message, User } from '../types/domain';

/** Converts domain objects into the JSON shapes returned by the API (dates as ISO strings). */

export const serializeUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

export const serializeChat = (chat: Chat) => ({
  chatId: chat.id,
  memberIds: chat.members.map((member) => member.userId),
  members: chat.members.map((member) => ({
    userId: member.userId,
    joinedAt: member.joinedAt.toISOString(),
  })),
  createdAt: chat.createdAt.toISOString(),
  updatedAt: chat.updatedAt.toISOString(),
});

export const serializeMessage = (message: Message) => ({
  id: message.id,
  chatId: message.chatId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt.toISOString(),
  readBy: message.readBy.map((receipt) => ({
    userId: receipt.userId,
    readAt: receipt.readAt.toISOString(),
  })),
});

export const serializeLastSeen = (lastSeen: LastSeen) => ({
  userId: lastSeen.userId,
  messageId: lastSeen.messageId,
  messageCreatedAt: lastSeen.messageCreatedAt.toISOString(),
  seenAt: lastSeen.seenAt.toISOString(),
});
