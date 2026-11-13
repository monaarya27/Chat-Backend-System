import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from '../helpers/testApp';

describe('User management: POST /users, GET /users/:userId', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  it('registers the authenticated caller (id comes from the identity, email normalised)', async () => {
    const res = await ctx.as('newUser').post('/users', { name: 'New User', email: '  NEW@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: 'newUser', name: 'New User', email: 'new@example.com' });
  });

  it('returns 409 when the user already exists', async () => {
    const res = await ctx.as('user1').post('/users', { name: 'Again', email: 'other@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_ALREADY_EXISTS');
  });

  it('returns 409 when the email is taken', async () => {
    const res = await ctx.as('newUser').post('/users', { name: 'Dup', email: 'user1@example.com' });
    expect(res.status).toBe(409);
  });

  it('validates name and email (400)', async () => {
    const res = await ctx.as('newUser').post('/users', { name: '', email: 'not-an-email' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('gets a user by id', async () => {
    const res = await ctx.as('user2').get('/users/user1');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user1');
  });

  it('returns 404 for an unknown user', async () => {
    const res = await ctx.as('user1').get('/users/nobody');
    expect(res.status).toBe(404);
  });

  it('rejects a malformed X-User-Id header (401)', async () => {
    const res = await request(ctx.app).get('/users/user1').set('X-User-Id', 'not valid!');
    expect(res.status).toBe(401);
  });

  it('explains how to register when the X-User-Id header is missing (401)', async () => {
    const res = await request(ctx.app).post('/users').send({ name: 'New User', email: 'new@example.com' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/X-User-Id/);
    expect(res.body.error.message).toMatch(/POST \/users/);
  });

  it('registers once the identity header is sent (the fix for that 401)', async () => {
    const res = await request(ctx.app)
      .post('/users')
      .set('X-User-Id', 'user4')
      .send({ name: 'New User', email: 'new@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe('user4');
  });
});
