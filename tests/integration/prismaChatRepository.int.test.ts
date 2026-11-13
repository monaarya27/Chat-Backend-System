/**
 * Runs the REAL Prisma repositories + ChatService against a PostgreSQL TEST database.
 * Skipped unless TEST_DATABASE_URL is set. Use a throwaway database — this test
 * creates rows in it. To run:
 *   1. Create an empty database, e.g. chat_backend_test
 *   2. DATABASE_URL=<test url> npx prisma migrate deploy
 *   3. TEST_DATABASE_URL=<test url> npm run test:integration
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaChatRepository } from '../../src/repositories/prisma/prismaChatRepository';
import { PrismaUserRepository } from '../../src/repositories/prisma/prismaUserRepository';
import { ChatService } from '../../src/services/chatService';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Prisma repositories (real PostgreSQL)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  afterAll(() => prisma.$disconnect());

  it('creates exactly one chat for a pair even with 20 concurrent requests', async () => {
    const users = new PrismaUserRepository(prisma);
    const service = new ChatService(new PrismaChatRepository(prisma), users);
    const a = `it-${randomUUID()}`;
    const b = `it-${randomUUID()}`;
    await users.create({ id: a, name: 'A', email: `${a}@test.local` });
    await users.create({ id: b, name: 'B', email: `${b}@test.local` });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => service.createOrGetDirectChat(a, i % 2 ? a : b, i % 2 ? b : a)),
    );

    expect(new Set(results.map((r) => r.chat.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.chatMember.count({ where: { userId: a } })).toBe(1);
  });
});
