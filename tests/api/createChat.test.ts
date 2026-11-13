import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 1: POST /chat/create', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  it('creates a new chat with both users as members (201)', async () => {
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user2' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, created: true });
    expect(typeof res.body.chatId).toBe('string');
    expect(res.body.chat.chatId).toBe(res.body.chatId);
    expect(res.body.chat.memberIds.sort()).toEqual(['user1', 'user2']);
    expect(ctx.chatRepo.chats.size).toBe(1);
  });

  it('returns the existing chat on a second call (200, same chatId)', async () => {
    const first = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user2' });
    const second = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user2' });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, created: false, chatId: first.body.chatId });
    expect(ctx.chatRepo.chats.size).toBe(1);
  });

  it('treats (A,B) and (B,A) as the same chat', async () => {
    const first = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user2' });
    const reversed = await ctx.as('user2').post('/chat/create', { userAId: 'user2', userBId: 'user1' });

    expect(reversed.status).toBe(200);
    expect(reversed.body.chatId).toBe(first.body.chatId);
    expect(ctx.chatRepo.chats.size).toBe(1);
  });

  it('prevents duplicates under concurrent requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user2' })
          : ctx.as('user2').post('/chat/create', { userAId: 'user2', userBId: 'user1' }),
      ),
    );

    const ids = new Set(responses.map((r) => r.body.chatId));
    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(responses.filter((r) => r.body.created === true)).toHaveLength(1);
    expect(ids.size).toBe(1);
    expect(ctx.chatRepo.chats.size).toBe(1);
  });

  it('creates separate chats for different pairs', async () => {
    const a = await ctx.createChat('user1', 'user2');
    const b = await ctx.createChat('user1', 'user3');
    expect(a).not.toBe(b);
  });

  it('returns 404 listing the users that do not exist', async () => {
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'ghost' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'USER_NOT_FOUND', details: { missing: ['ghost'] } });
  });

  it('rejects a chat with yourself (400)', async () => {
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'user1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_USER');
  });

  it('rejects creating a chat between two other users (403)', async () => {
    const res = await ctx.as('user3').post('/chat/create', { userAId: 'user1', userBId: 'user2' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_PARTICIPANT');
  });

  it('returns 400 with field details when required fields are missing', async () => {
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'userBId', message: 'userBId is required' }]);
  });

  it('rejects malformed user ids (400)', async () => {
    const res = await ctx.as('user1').post('/chat/create', { userAId: 'user1', userBId: 'bad id!' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('userBId');
  });

  it('requires authentication (401)', async () => {
    const res = await request(ctx.app).post('/chat/create').send({ userAId: 'user1', userBId: 'user2' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
