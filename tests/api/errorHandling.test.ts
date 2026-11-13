import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translateFirestoreError } from '../../src/repositories/firestore/firestoreErrors';
import { translatePrismaError } from '../../src/repositories/prisma/prismaErrors';
import { Prisma } from '@prisma/client';
import { buildTestApp, type TestContext } from '../helpers/testApp';

/**
 * Infrastructure failures. The fakes are made to throw exactly what the real
 * Prisma / Firestore repositories throw after error translation, so these tests
 * cover the full path: driver error -> translation -> error handler -> HTTP response.
 */
describe('PostgreSQL and Firestore failure scenarios', () => {
  let ctx: TestContext;
  let chatId: string;
  beforeEach(async () => {
    ctx = await buildTestApp();
    chatId = await ctx.createChat('user1', 'user2');
  });

  const postgresDown = () =>
    translatePrismaError(new Prisma.PrismaClientInitializationError("Can't reach database server", '6.19.3'));
  const firestoreDown = () => translateFirestoreError(Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }));

  it('returns 503 when PostgreSQL is unreachable while creating a chat', async () => {
    vi.spyOn(ctx.userRepo, 'findManyByIds').mockRejectedValueOnce(postgresDown());
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user3' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('returns 503 when PostgreSQL is unreachable while listing chats', async () => {
    vi.spyOn(ctx.chatRepo, 'listForUser').mockRejectedValueOnce(postgresDown());
    const res = await ctx.as('user1').get('/user/user1/chats');
    expect(res.status).toBe(503);
  });

  it('returns 503 when Firestore is unavailable while sending a message', async () => {
    vi.spyOn(ctx.store, 'createMessage').mockRejectedValueOnce(firestoreDown());
    const res = await ctx.as('user1').post(`/chat/${chatId}/message/send`, { senderId: 'user1', text: 'hi' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FIRESTORE_UNAVAILABLE');
  });

  it('returns 500 with a helpful code when Firestore rejects the credentials', async () => {
    vi.spyOn(ctx.store, 'listMessages').mockRejectedValueOnce(
      translateFirestoreError(Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 })),
    );
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FIRESTORE_AUTH_ERROR');
  });

  it('returns 503 when Firestore fails during mark-as-read', async () => {
    const messageId = await ctx.sendMessage(chatId, 'user1', 'hi');
    vi.spyOn(ctx.store, 'markRead').mockRejectedValueOnce(firestoreDown());
    const res = await ctx.as('user2').post(`/chat/${chatId}/message/${messageId}/read`, { userId: 'user2' });
    expect(res.status).toBe(503);
  });

  it('returns 503 when Firestore fails during last-seen update', async () => {
    const messageId = await ctx.sendMessage(chatId, 'user1', 'hi');
    vi.spyOn(ctx.store, 'updateLastSeen').mockRejectedValueOnce(firestoreDown());
    const res = await ctx.as('user2').post(`/chat/${chatId}/lastseen`, { userId: 'user2', messageId });
    expect(res.status).toBe(503);
  });

  it('hides internal details of unexpected errors (500)', async () => {
    vi.spyOn(ctx.chatRepo, 'findById').mockRejectedValueOnce(new Error('secret stack detail'));
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});

describe('General HTTP behaviour', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const { as } = await buildTestApp();
    const res = await as('user1').get('/does/not/exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('echoes X-Request-Id for tracing', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/health').set('X-Request-Id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('GET /health is public and does not touch the databases', async () => {
    const check = vi.fn();
    const { app } = await buildTestApp({ healthChecks: [{ name: 'postgres', check }] });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });

  it('GET /health/ready reports 503 when a dependency is down', async () => {
    const { app } = await buildTestApp({
      healthChecks: [
        { name: 'postgres', check: async () => undefined },
        { name: 'firestore', check: async () => Promise.reject(new Error('connection refused')) },
      ],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual([
      { name: 'postgres', status: 'up' },
      { name: 'firestore', status: 'down', error: 'connection refused' },
    ]);
  });
});
