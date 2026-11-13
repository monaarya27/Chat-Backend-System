import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 5: POST /chat/:chatId/lastseen', () => {
  let ctx: TestContext;
  let chatId: string;
  let m1: string;
  let m2: string;
  let m3: string;
  beforeEach(async () => {
    ctx = await buildTestApp();
    chatId = await ctx.createChat('user1', 'user2');
    m1 = await ctx.sendMessage(chatId, 'user1', 'one');
    m2 = await ctx.sendMessage(chatId, 'user1', 'two');
    m3 = await ctx.sendMessage(chatId, 'user1', 'three');
  });

  const update = (userId: string, messageId: string) =>
    ctx.as(userId).post(`/chat/${chatId}/lastseen`, { userId, messageId });

  it("stores the user's last seen message and timestamp", async () => {
    const res = await update('user2', m2);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      updated: true,
      lastSeen: { userId: 'user2', messageId: m2, messageCreatedAt: expect.any(String), seenAt: expect.any(String) },
    });
  });

  it('moves forward to a newer message', async () => {
    await update('user2', m1);
    const res = await update('user2', m3);
    expect(res.body).toMatchObject({ updated: true, lastSeen: { messageId: m3 } });
  });

  it('never moves backwards: an older message is ignored and the current position is returned', async () => {
    await update('user2', m3);
    const res = await update('user2', m1);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: false, lastSeen: { messageId: m3 } });

    const list = await ctx.as('user2').get(`/chat/${chatId}/lastseen`);
    expect(list.body.lastSeen).toEqual([expect.objectContaining({ userId: 'user2', messageId: m3 })]);
  });

  it('is a no-op when repeating the same message', async () => {
    const first = await update('user2', m2);
    const again = await update('user2', m2);
    expect(again.body.updated).toBe(false);
    expect(again.body.lastSeen.seenAt).toBe(first.body.lastSeen.seenAt);
  });

  it('tracks each member independently', async () => {
    await update('user2', m3);
    await update('user1', m1);
    const res = await ctx.as('user1').get(`/chat/${chatId}/lastseen`);
    const byUser = Object.fromEntries(
      res.body.lastSeen.map((e: { userId: string; messageId: string }) => [e.userId, e.messageId]),
    );
    expect(byUser).toEqual({ user1: m1, user2: m3 });
  });

  it('returns 404 when the message is not in this chat', async () => {
    const otherChat = await ctx.createChat('user2', 'user3');
    const foreign = await ctx.sendMessage(otherChat, 'user3', 'elsewhere');
    const res = await update('user2', foreign);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('forbids non-members (403)', async () => {
    const res = await update('user3', m1);
    expect(res.status).toBe(403);
  });

  it('forbids updating someone else (403)', async () => {
    const res = await ctx.as('user1').post(`/chat/${chatId}/lastseen`, { userId: 'user2', messageId: m1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
  });

  it('returns 400 when messageId is missing', async () => {
    const res = await ctx.as('user2').post(`/chat/${chatId}/lastseen`, { userId: 'user2' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ field: 'messageId', message: 'messageId is required' });
  });

  it('returns 404 for an unknown chat', async () => {
    const res = await ctx.as('user2').post('/chat/nope/lastseen', { userId: 'user2', messageId: m1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAT_NOT_FOUND');
  });
});
