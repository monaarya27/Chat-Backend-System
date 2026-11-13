import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/config/constants';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 2: POST /chat/:chatId/message/send', () => {
  let ctx: TestContext;
  let chatId: string;
  beforeEach(async () => {
    ctx = await buildTestApp();
    chatId = await ctx.createChat('user1', 'user2');
  });

  it('stores the message and returns it with a generated id and server timestamp (201)', async () => {
    const res = await ctx.as('user1').post(`/chat/${chatId}/message/send`, { senderId: 'user1', text: '  Hello!  ' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatchObject({ chatId, senderId: 'user1', text: 'Hello!', readBy: [] });
    expect(res.body.message.id).toEqual(expect.any(String));
    expect(new Date(res.body.message.createdAt).toISOString()).toBe(res.body.message.createdAt);

    const stored = await ctx.store.getMessage(chatId, res.body.message.id);
    expect(stored?.text).toBe('Hello!');
  });

  it('generates a unique id for every message', async () => {
    const ids = await Promise.all([1, 2, 3].map((n) => ctx.sendMessage(chatId, 'user1', `msg ${n}`)));
    expect(new Set(ids).size).toBe(3);
  });

  it("bumps the chat's updatedAt so it moves to the top of the chat list", async () => {
    const before = (await ctx.chatRepo.findById(chatId))!.updatedAt;
    await ctx.sendMessage(chatId, 'user2', 'hi');
    const after = (await ctx.chatRepo.findById(chatId))!.updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('rejects users who are not members of the chat (403)', async () => {
    const res = await ctx.as('user3').post(`/chat/${chatId}/message/send`, { senderId: 'user3', text: 'sneaky' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_CHAT_MEMBER');
  });

  it('rejects sending on behalf of another user (403)', async () => {
    const res = await ctx.as('user3').post(`/chat/${chatId}/message/send`, { senderId: 'user1', text: 'spoof' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
  });

  it('returns 404 for a chat that does not exist', async () => {
    const res = await ctx.as('user1').post('/chat/no-such-chat/message/send', { senderId: 'user1', text: 'hi' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAT_NOT_FOUND');
  });

  it('returns 400 for an invalid chat id', async () => {
    const res = await ctx.as('user1').post('/chat/bad.id/message/send', { senderId: 'user1', text: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('chatId');
  });

  it.each([
    [{ senderId: 'user1' }, 'text', 'text is required'],
    [{ senderId: 'user1', text: '   ' }, 'text', 'text cannot be empty'],
    [{ senderId: 'user1', text: 42 }, 'text', 'text must be a string'],
    [{ text: 'hi' }, 'senderId', 'senderId is required'],
    [
      { senderId: 'user1', text: 'x'.repeat(LIMITS.MESSAGE_MAX_LENGTH + 1) },
      'text',
      `text must be at most ${LIMITS.MESSAGE_MAX_LENGTH} characters`,
    ],
  ])('validates the body: %j -> 400', async (body, field, message) => {
    const res = await ctx.as('user1').post(`/chat/${chatId}/message/send`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ field, message });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(ctx.app)
      .post(`/chat/${chatId}/message/send`)
      .set('X-User-Id', 'user1')
      .set('Content-Type', 'application/json')
      .send('{"senderId": "user1", "text": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('still succeeds if bumping the chat timestamp in PostgreSQL fails (message is already stored)', async () => {
    vi.spyOn(ctx.chatRepo, 'touch').mockRejectedValueOnce(new Error('postgres hiccup'));
    const res = await ctx.as('user1').post(`/chat/${chatId}/message/send`, { senderId: 'user1', text: 'hi' });
    expect(res.status).toBe(201);
  });
});
