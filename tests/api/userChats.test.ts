import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('API 6: GET /user/:userId/chats', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  it('lists the chats of the user with member ids and timestamps', async () => {
    const chatId = await ctx.createChat('user1', 'user2');
    const res = await ctx.as('user1').get('/user/user1/chats');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, userId: 'user1', count: 1 });
    expect(res.body.chats[0]).toEqual({
      chatId,
      memberIds: ['user1', 'user2'],
      members: [
        { userId: 'user1', joinedAt: expect.any(String) },
        { userId: 'user2', joinedAt: expect.any(String) },
      ],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('sorts chats by most recently updated first', async () => {
    const older = await ctx.createChat('user1', 'user2');
    const newer = await ctx.createChat('user1', 'user3');

    let res = await ctx.as('user1').get('/user/user1/chats');
    expect(res.body.chats.map((c: { chatId: string }) => c.chatId)).toEqual([newer, older]);

    // A new message in the older chat moves it to the top.
    await ctx.sendMessage(older, 'user2', 'bump');
    res = await ctx.as('user1').get('/user/user1/chats');
    expect(res.body.chats.map((c: { chatId: string }) => c.chatId)).toEqual([older, newer]);
  });

  it("only includes the user's own chats", async () => {
    await ctx.createChat('user2', 'user3');
    const res = await ctx.as('user1').get('/user/user1/chats');
    expect(res.body).toMatchObject({ count: 0, chats: [] });
  });

  it("forbids listing another user's chats (403)", async () => {
    const res = await ctx.as('user2').get('/user/user1/chats');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
  });

  it('returns 404 for a user that does not exist', async () => {
    const res = await ctx.as('ghost').get('/user/ghost/chats');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 400 for an invalid user id', async () => {
    const res = await ctx.as('user1').get('/user/bad.id/chats');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('userId');
  });
});
