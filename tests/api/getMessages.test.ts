import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/config/constants';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 3: GET /chat/:chatId/messages', () => {
  let ctx: TestContext;
  let chatId: string;
  beforeEach(async () => {
    ctx = await buildTestApp();
    chatId = await ctx.createChat('user1', 'user2');
  });

  it('returns messages in ascending timestamp order, regardless of insertion order', async () => {
    // Insert out of order on purpose.
    ctx.store.seed(chatId, 'user1', 'third', new Date('2026-02-01T10:00:03Z'));
    ctx.store.seed(chatId, 'user2', 'first', new Date('2026-02-01T10:00:01Z'));
    ctx.store.seed(chatId, 'user1', 'second', new Date('2026-02-01T10:00:02Z'));

    const res = await ctx.as('user2').get(`/chat/${chatId}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(['first', 'second', 'third']);
    expect(res.body.messages[0]).toMatchObject({ senderId: 'user2', readBy: [] });
    expect(res.body.pagination).toEqual({ limit: LIMITS.MESSAGES_DEFAULT_PAGE_SIZE, count: 3, hasMore: false, nextCursor: null });
  });

  it('paginates with a cursor without skipping or repeating messages', async () => {
    for (let i = 1; i <= 7; i++) await ctx.sendMessage(chatId, i % 2 ? 'user1' : 'user2', `m${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/chat/${chatId}/messages?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await ctx.as('user1').get(url);
      expect(res.status).toBe(200);
      seen.push(...res.body.messages.map((m: { text: string }) => m.text));
      cursor = res.body.pagination.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('reports hasMore/nextCursor correctly on a full page', async () => {
    for (let i = 1; i <= 3; i++) await ctx.sendMessage(chatId, 'user1', `m${i}`);
    const exact = await ctx.as('user1').get(`/chat/${chatId}/messages?limit=3`);
    expect(exact.body.pagination).toMatchObject({ count: 3, hasMore: false, nextCursor: null });

    const partial = await ctx.as('user1').get(`/chat/${chatId}/messages?limit=2`);
    expect(partial.body.pagination).toMatchObject({ count: 2, hasMore: true, nextCursor: partial.body.messages[1].id });
  });

  it('includes read receipt information', async () => {
    const messageId = await ctx.sendMessage(chatId, 'user1', 'read me');
    await ctx.as('user2').post(`/chat/${chatId}/message/${messageId}/read`, { userId: 'user2' });

    const res = await ctx.as('user1').get(`/chat/${chatId}/messages`);
    expect(res.body.messages[0].readBy).toEqual([{ userId: 'user2', readAt: expect.any(String) }]);
  });

  it('returns an empty list for a chat with no messages', async () => {
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it.each([
    ['0', 'limit must be at least 1'],
    [String(LIMITS.MESSAGES_MAX_PAGE_SIZE + 1), `limit must be at most ${LIMITS.MESSAGES_MAX_PAGE_SIZE}`],
    ['abc', 'limit must be a number'],
    ['2.5', 'limit must be an integer'],
  ])('rejects limit=%s (400)', async (limit, message) => {
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages?limit=${limit}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ field: 'limit', message });
  });

  it('accepts the maximum limit', async () => {
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages?limit=${LIMITS.MESSAGES_MAX_PAGE_SIZE}`);
    expect(res.status).toBe(200);
  });

  it('rejects an unknown cursor (400)', async () => {
    const res = await ctx.as('user1').get(`/chat/${chatId}/messages?cursor=does-not-exist`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('forbids non-members from reading messages (403)', async () => {
    await ctx.sendMessage(chatId, 'user1', 'private');
    const res = await ctx.as('user3').get(`/chat/${chatId}/messages`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_CHAT_MEMBER');
  });

  it('returns 404 for a chat that does not exist', async () => {
    const res = await ctx.as('user1').get('/chat/missing-chat/messages');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAT_NOT_FOUND');
  });
});
