import { z } from 'zod';
import { LIMITS } from '../config/constants';
import {
  chatIdParams,
  chatMessageParams,
  createChatBody,
  createUserBody,
  getMessagesQuery,
  markReadBody,
  sendMessageBody,
  updateLastSeenBody,
  userIdParams,
} from '../validators/schemas';

/**
 * OpenAPI 3.0 specification served by Swagger UI at /docs (raw JSON at /docs/openapi.json).
 *
 * Request bodies, path params and query params are GENERATED from the Zod validators
 * the controllers use (src/validators/schemas.ts), so documented limits, patterns and
 * required fields always match the real validation. tests/api/docs.test.ts checks
 * that the documented routes match the registered routes, and that the documented
 * constraints really are enforced by the running app.
 */

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[] };

/** Converts a Zod validator to an OpenAPI 3.0 schema describing what clients may send. */
export function toOpenApiSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  return json;
}

/** Turns a Zod object (params or query) into OpenAPI parameter objects. */
function toParameters(schema: z.ZodObject, location: 'path' | 'query') {
  const json = toOpenApiSchema(schema);
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const { description, example, ...propertySchema } = property;
    return {
      name,
      in: location,
      required: location === 'path' || (json.required ?? []).includes(name),
      ...(description ? { description } : {}),
      ...(example !== undefined ? { example } : {}),
      schema: propertySchema,
    };
  });
}

const jsonBody = (schemaRef: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});

const ok = (description: string, schemaRef: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});

/** Error response; `codes` lists the `error.code` values this status can carry. */
const err = (description: string, codes: string[]) => ({
  description: `${description}<br/>Codes: ${codes.map((code) => `\`${code}\``).join(', ')}`,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

const VALIDATION_400 = 'Invalid path/query parameters or request body (see `error.details`)';
const common401 = { '401': err('Missing or invalid identity', ['UNAUTHORIZED']) };
const common503 = {
  '503': err('PostgreSQL or Firestore temporarily unavailable; safe to retry', [
    'DATABASE_UNAVAILABLE',
    'FIRESTORE_UNAVAILABLE',
  ]),
};
/** Extra errors for endpoints that take a JSON body. */
const bodyErrors = { '413': err('Request body larger than 100 KB', ['PAYLOAD_TOO_LARGE']) };
const bodyValidation = ['VALIDATION_ERROR', 'INVALID_JSON'];

const chatIdParam = toParameters(chatIdParams, 'path');

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Chat Backend System API',
    version: '1.0.0',
    description: [
      'One-to-one chat backend. Users, chats and memberships are stored in **PostgreSQL** (Prisma);',
      'messages, read receipts and last-seen pointers in **Firebase Firestore** (or in memory when',
      'Firebase is not configured, development only).',
      '',
      '**Authentication:** click **Authorize** and fill in ONE of:',
      '- `devUserId`: when the server runs with `AUTH_MODE=dev` (local only). Enter a user id such as `user1`.',
      '- `firebaseIdToken`: when the server runs with `AUTH_MODE=firebase`. Paste a Firebase ID token.',
      '',
      'The ids in request bodies (`senderId`, `userId`) must match the authenticated user.',
      'Run `npm run db:seed` to create the demo users `user1`, `user2`, `user3`.',
      '',
      '**Validation rules** (generated from the server\'s validators): ids are 1–128 characters of',
      `letters, digits, \`_\` and \`-\`; text fields are trimmed before validation; unknown body fields are ignored.`,
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Chats', description: 'Create chats and list a user\'s chats (PostgreSQL)' },
    { name: 'Messages', description: 'Messages, read receipts and last seen (Firestore)' },
    { name: 'Users', description: 'User management (PostgreSQL)' },
    { name: 'Health', description: 'Liveness and readiness checks' },
  ],
  security: [{ devUserId: [] }, { firebaseIdToken: [] }],
  paths: {
    '/chat/create': {
      post: {
        tags: ['Chats'],
        summary: 'API 1: Create or get a one-to-one chat',
        description:
          'Returns the existing chat between the two users, or creates it. The caller must be one of the two users. ' +
          'Duplicate chats are impossible, even under concurrent requests (UNIQUE key on the sorted user pair).',
        requestBody: jsonBody('#/components/schemas/CreateChatRequest'),
        responses: {
          '200': ok('Chat already existed (`created: false`)', '#/components/schemas/CreateChatResponse'),
          '201': ok('New chat created (`created: true`)', '#/components/schemas/CreateChatResponse'),
          '400': err(`${VALIDATION_400}, or userAId = userBId`, [...bodyValidation, 'SAME_USER']),
          ...common401,
          '403': err('Caller is not one of the two users', ['NOT_A_PARTICIPANT']),
          '404': err('One or both users do not exist (`details.missing` lists them)', ['USER_NOT_FOUND']),
          ...bodyErrors,
          ...common503,
        },
      },
    },
    '/chat/{chatId}/message/send': {
      post: {
        tags: ['Messages'],
        summary: 'API 2: Send a message',
        description: 'Stores the message with a server-generated timestamp and a generated unique id.',
        parameters: chatIdParam,
        requestBody: jsonBody('#/components/schemas/SendMessageRequest'),
        responses: {
          '201': ok('Message created', '#/components/schemas/SendMessageResponse'),
          '400': err(VALIDATION_400, bodyValidation),
          ...common401,
          '403': err('Not a chat member, or senderId ≠ caller', ['NOT_A_CHAT_MEMBER', 'IDENTITY_MISMATCH']),
          '404': err('Chat not found', ['CHAT_NOT_FOUND']),
          ...bodyErrors,
          ...common503,
        },
      },
    },
    '/chat/{chatId}/messages': {
      get: {
        tags: ['Messages'],
        summary: 'API 3: Get messages (oldest first, cursor pagination)',
        description:
          'Returns messages in ascending timestamp order with their read receipts. To get the next page, pass ' +
          '`pagination.nextCursor` from the previous response as `cursor`.',
        parameters: [...chatIdParam, ...toParameters(getMessagesQuery, 'query')],
        responses: {
          '200': ok('A page of messages', '#/components/schemas/GetMessagesResponse'),
          '400': err(`${VALIDATION_400}, or cursor is not a message of this chat`, ['VALIDATION_ERROR', 'INVALID_CURSOR']),
          ...common401,
          '403': err('Caller is not a chat member', ['NOT_A_CHAT_MEMBER']),
          '404': err('Chat not found', ['CHAT_NOT_FOUND']),
          ...common503,
        },
      },
    },
    '/chat/{chatId}/message/{messageId}/read': {
      post: {
        tags: ['Messages'],
        summary: 'API 4: Mark a message as read',
        description:
          'Idempotent: calling again returns `alreadyRead: true` with the original `readAt`, and no duplicate ' +
          'receipt is stored. You cannot mark your own message as read.',
        parameters: toParameters(chatMessageParams, 'path'),
        requestBody: jsonBody('#/components/schemas/MarkReadRequest'),
        responses: {
          '200': ok('Receipt stored, or already existed', '#/components/schemas/MarkReadResponse'),
          '400': err(`${VALIDATION_400}, or the message is your own`, [...bodyValidation, 'OWN_MESSAGE']),
          ...common401,
          '403': err('Not a chat member, or userId ≠ caller', ['NOT_A_CHAT_MEMBER', 'IDENTITY_MISMATCH']),
          '404': err('Chat or message not found', ['CHAT_NOT_FOUND', 'MESSAGE_NOT_FOUND']),
          ...bodyErrors,
          ...common503,
        },
      },
    },
    '/chat/{chatId}/lastseen': {
      post: {
        tags: ['Messages'],
        summary: 'API 5: Update last seen message',
        description:
          'Moves the user\'s last-seen pointer forward. An older (or the same) message is ignored: ' +
          'the response then has `updated: false` and returns the current pointer.',
        parameters: chatIdParam,
        requestBody: jsonBody('#/components/schemas/UpdateLastSeenRequest'),
        responses: {
          '200': ok('Pointer updated, or unchanged', '#/components/schemas/UpdateLastSeenResponse'),
          '400': err(VALIDATION_400, bodyValidation),
          ...common401,
          '403': err('Not a chat member, or userId ≠ caller', ['NOT_A_CHAT_MEMBER', 'IDENTITY_MISMATCH']),
          '404': err('Chat not found, or message not in this chat', ['CHAT_NOT_FOUND', 'MESSAGE_NOT_FOUND']),
          ...bodyErrors,
          ...common503,
        },
      },
      get: {
        tags: ['Messages'],
        summary: 'Get last seen pointers of all chat members',
        parameters: chatIdParam,
        responses: {
          '200': ok('Last-seen pointers', '#/components/schemas/ListLastSeenResponse'),
          '400': err(VALIDATION_400, ['VALIDATION_ERROR']),
          ...common401,
          '403': err('Caller is not a chat member', ['NOT_A_CHAT_MEMBER']),
          '404': err('Chat not found', ['CHAT_NOT_FOUND']),
          ...common503,
        },
      },
    },
    '/user/{userId}/chats': {
      get: {
        tags: ['Chats'],
        summary: 'API 6: List a user\'s chats',
        description: 'Most recently updated first. Users can only list their own chats.',
        parameters: toParameters(userIdParams, 'path'),
        responses: {
          '200': ok('The user\'s chats', '#/components/schemas/ListChatsResponse'),
          '400': err(VALIDATION_400, ['VALIDATION_ERROR']),
          ...common401,
          '403': err('userId ≠ caller', ['IDENTITY_MISMATCH']),
          '404': err('User not found', ['USER_NOT_FOUND']),
          ...common503,
        },
      },
    },
    '/users': {
      post: {
        tags: ['Users'],
        summary: 'Register the authenticated caller',
        description: [
          'The body has **no id field**: the new user\'s id is taken from your identity, so nobody can',
          'register accounts under someone else\'s id.',
          '',
          '**How to register in Swagger (AUTH_MODE=dev):**',
          '1. Click **Authorize** (top right).',
          '2. Under `devUserId`, enter the id the NEW user should get, e.g. `user4`, then Authorize → Close.',
          '3. Try it out → Execute.',
          '',
          'Postman/curl: send the header `X-User-Id: user4`. Without it you get **401 UNAUTHORIZED**.',
          'With `AUTH_MODE=firebase`, the id is the uid of the Firebase ID token you send.',
        ].join('\n'),
        requestBody: jsonBody('#/components/schemas/CreateUserRequest'),
        responses: {
          '201': ok('User created', '#/components/schemas/UserResponse'),
          '400': err(VALIDATION_400, bodyValidation),
          '401': err(
            'No X-User-Id header (dev mode) or Bearer token (firebase mode), so the server cannot know which ' +
              'id to register. Click Authorize first.',
            ['UNAUTHORIZED'],
          ),
          '409': err('User id or email already exists', ['USER_ALREADY_EXISTS']),
          ...bodyErrors,
          ...common503,
        },
      },
    },
    '/users/{userId}': {
      get: {
        tags: ['Users'],
        summary: 'Get a user',
        parameters: toParameters(userIdParams, 'path'),
        responses: {
          '200': ok('The user', '#/components/schemas/UserResponse'),
          '400': err(VALIDATION_400, ['VALIDATION_ERROR']),
          ...common401,
          '404': err('User not found', ['USER_NOT_FOUND']),
          ...common503,
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness (does not touch databases)',
        security: [],
        responses: { '200': { description: 'Process is up' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness (pings PostgreSQL, and Firestore if configured)',
        security: [],
        responses: {
          '200': ok('All dependencies up', '#/components/schemas/ReadinessResponse'),
          '503': ok('At least one dependency down', '#/components/schemas/ReadinessResponse'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      devUserId: {
        type: 'apiKey',
        in: 'header',
        name: 'X-User-Id',
        description:
          'AUTH_MODE=dev only (local development). The user id to act as, e.g. user1 ' +
          `(1–${LIMITS.ID_MAX_LENGTH} letters, digits, "_" or "-").`,
      },
      firebaseIdToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Firebase ID token',
        description: 'AUTH_MODE=firebase. A Firebase Authentication ID token.',
      },
    },
    schemas: {
      Timestamp: { type: 'string', format: 'date-time', example: '2026-11-13T10:00:00.000Z' },

      // ---- Requests: generated from the Zod validators ----
      CreateChatRequest: toOpenApiSchema(createChatBody),
      SendMessageRequest: toOpenApiSchema(sendMessageBody),
      MarkReadRequest: toOpenApiSchema(markReadBody),
      UpdateLastSeenRequest: toOpenApiSchema(updateLastSeenBody),
      CreateUserRequest: toOpenApiSchema(createUserBody),

      // ---- Responses ----
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'user1' },
          name: { type: 'string', example: 'Alice Johnson' },
          email: { type: 'string', format: 'email', example: 'alice@example.com' },
          createdAt: { $ref: '#/components/schemas/Timestamp' },
          updatedAt: { $ref: '#/components/schemas/Timestamp' },
        },
      },
      Chat: {
        type: 'object',
        properties: {
          chatId: { type: 'string', example: '3f0c2a8e-6a3b-4c51-9d5e-1b2f7c9a0d11' },
          memberIds: { type: 'array', items: { type: 'string' }, example: ['user1', 'user2'] },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: { userId: { type: 'string' }, joinedAt: { $ref: '#/components/schemas/Timestamp' } },
            },
          },
          createdAt: { $ref: '#/components/schemas/Timestamp' },
          updatedAt: { $ref: '#/components/schemas/Timestamp' },
        },
      },
      ReadReceipt: {
        type: 'object',
        properties: { userId: { type: 'string', example: 'user2' }, readAt: { $ref: '#/components/schemas/Timestamp' } },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'Xq3b9QfJ2nT8kLm1pR4s' },
          chatId: { type: 'string' },
          senderId: { type: 'string', example: 'user1' },
          text: { type: 'string', example: 'Hello!' },
          createdAt: { $ref: '#/components/schemas/Timestamp' },
          readBy: { type: 'array', items: { $ref: '#/components/schemas/ReadReceipt' } },
        },
      },
      LastSeen: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          messageId: { type: 'string' },
          messageCreatedAt: { $ref: '#/components/schemas/Timestamp' },
          seenAt: { $ref: '#/components/schemas/Timestamp' },
        },
      },

      CreateChatResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          chatId: { type: 'string' },
          created: { type: 'boolean' },
          chat: { $ref: '#/components/schemas/Chat' },
        },
      },
      SendMessageResponse: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, message: { $ref: '#/components/schemas/Message' } },
      },
      GetMessagesResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          chatId: { type: 'string' },
          messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
          pagination: {
            type: 'object',
            properties: {
              limit: { type: 'integer', example: 50 },
              count: { type: 'integer', example: 1 },
              hasMore: { type: 'boolean', example: false },
              nextCursor: { type: 'string', nullable: true, example: null },
            },
          },
        },
      },
      MarkReadResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          alreadyRead: { type: 'boolean' },
          receipt: {
            type: 'object',
            properties: {
              chatId: { type: 'string' },
              messageId: { type: 'string' },
              userId: { type: 'string' },
              readAt: { $ref: '#/components/schemas/Timestamp' },
            },
          },
        },
      },
      UpdateLastSeenResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          updated: { type: 'boolean', description: 'false when the request would have moved last-seen backwards' },
          lastSeen: { $ref: '#/components/schemas/LastSeen' },
        },
      },
      ListLastSeenResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          chatId: { type: 'string' },
          lastSeen: { type: 'array', items: { $ref: '#/components/schemas/LastSeen' } },
        },
      },
      ListChatsResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          userId: { type: 'string' },
          count: { type: 'integer' },
          chats: { type: 'array', items: { $ref: '#/components/schemas/Chat' } },
        },
      },
      UserResponse: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, user: { $ref: '#/components/schemas/User' } },
      },
      ReadinessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          status: { type: 'string', enum: ['ready', 'degraded'] },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'postgres' },
                status: { type: 'string', enum: ['up', 'down'] },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Request validation failed' },
              details: {
                description:
                  'Optional. VALIDATION_ERROR: array of `{ field, message }`, one per invalid field. ' +
                  'USER_NOT_FOUND: `{ missing: [userIds] }`.',
                example: [{ field: 'text', message: 'text is required' }],
              },
              requestId: { type: 'string', description: 'Matches the X-Request-Id response header' },
            },
          },
        },
      },
    },
  },
};
