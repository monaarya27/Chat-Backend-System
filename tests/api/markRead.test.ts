import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 4: POST /chat/:chatId/message/:messageId/read', () => {
  let ctx: TestContext;
  let chatId: string;
  let messageId: string;
  beforeEach(async () => {
    ctx = await buildTestApp();
    chatId = await ctx.createChat('user1', 'user2');
    messageId = await ctx.sendMessage(chatId, 'user1', 'Hello!');
  });

  const markRead = (userId: string, body: object = { userId }, id = messageId) =>
    ctx.as(userId).post(`/chat/${chatId}/message/${id}/read`, body);

  it('records who read the message and when', async () => {
    const res = await markRead('user2');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      alreadyRead: false,
      receipt: { chatId, messageId, userId: 'user2', readAt: expect.any(String) },
    });
    const stored = await ctx.store.getMessage(chatId, messageId);
    expect(stored?.readBy).toEqual([{ userId: 'user2', readAt: new Date(res.body.receipt.readAt) }]);
  });

  it('is idempotent: a second read keeps the original receipt and does not duplicate it', async () => {
    const first = await markRead('user2');
    const second = await markRead('user2');

    expect(second.status).toBe(200);
    expect(second.body.alreadyRead).toBe(true);
    expect(second.body.receipt.readAt).toBe(first.body.receipt.readAt);
    expect((await ctx.store.getMessage(chatId, messageId))?.readBy).toHaveLength(1);
  });

  it('does not create duplicate receipts under concurrent requests', async () => {
    const responses = await Promise.all([markRead('user2'), markRead('user2'), markRead('user2')]);
    expect(responses.filter((r) => r.body.alreadyRead === false)).toHaveLength(1);
    expect((await ctx.store.getMessage(chatId, messageId))?.readBy).toHaveLength(1);
  });

  it('rejects marking your own message as read (400)', async () => {
    const res = await markRead('user1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OWN_MESSAGE');
  });

  it('returns 404 when the message does not exist', async () => {
    const res = await markRead('user2', { userId: 'user2' }, 'missing-message');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('returns 404 when the message belongs to a different chat', async () => {
    const otherChat = await ctx.createChat('user2', 'user3');
    const res = await ctx.as('user2').post(`/chat/${otherChat}/message/${messageId}/read`, { userId: 'user2' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('forbids non-members (403)', async () => {
    const res = await markRead('user3');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_CHAT_MEMBER');
  });

  it('forbids marking read on behalf of someone else (403)', async () => {
    const res = await ctx.as('user1').post(`/chat/${chatId}/message/${messageId}/read`, { userId: 'user2' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
  });

  it('returns 400 when userId is missing', async () => {
    const res = await markRead('user2', {});
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ field: 'userId', message: 'userId is required' });
  });
});
