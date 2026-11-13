import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { DevHeaderIdentityVerifier } from '../../src/auth/identityVerifier';
import type { HealthCheck } from '../../src/repositories/types';
import { ChatService } from '../../src/services/chatService';
import { MessageService } from '../../src/services/messageService';
import { UserService } from '../../src/services/userService';
import { logger } from '../../src/utils/logger';
import { FakeClock, InMemoryChatRepository, InMemoryMessageStore, InMemoryUserRepository } from './fakes';

export const SEEDED_USERS = ['user1', 'user2', 'user3'] as const;

/**
 * Builds the real Express app (real routes, middleware, validation, services)
 * wired to in-memory repositories, with users user1..user3 already created.
 */
export async function buildTestApp(options: { healthChecks?: HealthCheck[] } = {}) {
  const clock = new FakeClock();
  const userRepo = new InMemoryUserRepository(clock);
  const chatRepo = new InMemoryChatRepository(clock);
  const store = new InMemoryMessageStore(clock);

  const chatService = new ChatService(chatRepo, userRepo);
  const messageService = new MessageService(chatService, chatRepo, store, logger);
  const userService = new UserService(userRepo, chatRepo);

  const app: Express = createApp({
    userService,
    chatService,
    messageService,
    identityVerifier: new DevHeaderIdentityVerifier(),
    healthChecks: options.healthChecks ?? [],
  });

  for (const id of SEEDED_USERS) {
    await userRepo.create({ id, name: `Name ${id}`, email: `${id}@example.com` });
  }

  /** Tiny helper so tests read like: api.as('user1').post(...) */
  const as = (userId: string) => ({
    get: (url: string) => request(app).get(url).set('X-User-Id', userId),
    post: (url: string, body?: object) => request(app).post(url).set('X-User-Id', userId).send(body),
  });

  /** Creates (or gets) a chat between two users and returns its id. */
  const createChat = async (a: string, b: string): Promise<string> => {
    const res = await as(a).post('/chat/create', { userAId: a, userBId: b });
    if (res.status !== 200 && res.status !== 201) throw new Error(`createChat failed: ${res.status}`);
    return res.body.chatId as string;
  };

  /** Sends a message through the API and returns its id. */
  const sendMessage = async (chatId: string, senderId: string, text: string): Promise<string> => {
    const res = await as(senderId).post(`/chat/${chatId}/message/send`, { senderId, text });
    if (res.status !== 201) throw new Error(`sendMessage failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.message.id as string;
  };

  return { app, as, createChat, sendMessage, userRepo, chatRepo, store, clock };
}

export type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
