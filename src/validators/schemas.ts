import { z } from 'zod';
import { LIMITS } from '../config/constants';
import { idField } from './common';

/**
 * Request validators. They are also the single source of truth for the Swagger
 * docs: src/docs/openapi.ts converts them to OpenAPI with z.toJSONSchema, so
 * documented limits can never drift from the real validation.
 */

const CHAT_ID_EXAMPLE = '3f0c2a8e-6a3b-4c51-9d5e-1b2f7c9a0d11';
const MESSAGE_ID_EXAMPLE = 'Xq3b9QfJ2nT8kLm1pR4s';

// ---------- Path params ----------
export const userIdParams = z.object({ userId: idField('userId', { description: 'User id', example: 'user1' }) });
export const chatIdParams = z.object({
  chatId: idField('chatId', { description: 'Chat id (from POST /chat/create)', example: CHAT_ID_EXAMPLE }),
});
export const chatMessageParams = z.object({
  chatId: idField('chatId', { description: 'Chat id (from POST /chat/create)', example: CHAT_ID_EXAMPLE }),
  messageId: idField('messageId', { description: 'Message id (from send message)', example: MESSAGE_ID_EXAMPLE }),
});

// ---------- Users ----------
export const createUserBody = z.object({
  name: z
    .string({ error: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(100, 'name must be at most 100 characters')
    .meta({ description: 'Display name (trimmed)', example: 'Dave Brown' }),
  email: z
    .string({ error: 'email is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email('email must be a valid email address').max(191, 'email is too long'))
    // The pipe hides the email check from the JSON-schema generator, so restate it for the docs.
    .meta({ format: 'email', maxLength: 191, description: 'Trimmed and lowercased; must be unique', example: 'dave@example.com' }),
});

// ---------- Chats ----------
export const createChatBody = z.object({
  userAId: idField('userAId', { description: 'One participant (must be you or userBId)', example: 'user1' }),
  userBId: idField('userBId', { description: 'The other participant; must differ from userAId', example: 'user2' }),
});

// ---------- Messages ----------
export const sendMessageBody = z.object({
  senderId: idField('senderId', { description: 'Must be the authenticated user', example: 'user1' }),
  text: z
    .string({
      error: (issue) => (issue.input === undefined ? 'text is required' : 'text must be a string'),
    })
    .trim()
    .min(1, 'text cannot be empty')
    .max(LIMITS.MESSAGE_MAX_LENGTH, `text must be at most ${LIMITS.MESSAGE_MAX_LENGTH} characters`)
    .meta({
      description: `Message text. Trimmed; must not be empty or only spaces; max ${LIMITS.MESSAGE_MAX_LENGTH} characters.`,
      example: 'Hello!',
    }),
});

export const getMessagesQuery = z.object({
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(LIMITS.MESSAGES_MAX_PAGE_SIZE, `limit must be at most ${LIMITS.MESSAGES_MAX_PAGE_SIZE}`)
    .default(LIMITS.MESSAGES_DEFAULT_PAGE_SIZE)
    .meta({ description: `Page size (1–${LIMITS.MESSAGES_MAX_PAGE_SIZE}); larger values are rejected` }),
  cursor: idField('cursor', {
    description: 'Id of the last message you already have (pagination.nextCursor); results start after it',
  }).optional(),
});

export const markReadBody = z.object({
  userId: idField('userId', { description: 'The reader; must be the authenticated user', example: 'user2' }),
});

export const updateLastSeenBody = z.object({
  userId: idField('userId', { description: 'Must be the authenticated user', example: 'user2' }),
  messageId: idField('messageId', { description: 'A message in this chat', example: MESSAGE_ID_EXAMPLE }),
});
