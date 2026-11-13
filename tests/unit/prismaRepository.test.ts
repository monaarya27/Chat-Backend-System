import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaChatRepository } from '../../src/repositories/prisma/prismaChatRepository';
import { translatePrismaError } from '../../src/repositories/prisma/prismaErrors';
import { DependencyError, ServiceUnavailableError, UniqueConstraintError } from '../../src/utils/errors';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma error ${code}`, { code, clientVersion: '6.19.3', meta });

describe('translatePrismaError', () => {
  it('maps P2002 (unique violation) to UniqueConstraintError with the field list', () => {
    const error = translatePrismaError(known('P2002', { target: ['direct_key'] }));
    expect(error).toBeInstanceOf(UniqueConstraintError);
    expect((error as UniqueConstraintError).fields).toEqual(['direct_key']);
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])('maps connectivity code %s to 503', (code) => {
    const error = translatePrismaError(known(code));
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).code).toBe('DATABASE_UNAVAILABLE');
  });

  it('maps initialization errors (PostgreSQL not running / bad URL) to 503', () => {
    const error = translatePrismaError(new Prisma.PrismaClientInitializationError('no server', '6.19.3'));
    expect(error).toBeInstanceOf(ServiceUnavailableError);
  });

  it('maps other known errors to a 500 DependencyError', () => {
    const error = translatePrismaError(known('P2003'));
    expect(error).toBeInstanceOf(DependencyError);
    expect((error as DependencyError).statusCode).toBe(500);
  });

  it('passes through unrelated errors unchanged', () => {
    const original = new TypeError('boom');
    expect(translatePrismaError(original)).toBe(original);
  });
});

describe('PrismaChatRepository (mocked PrismaClient)', () => {
  function makeRepo() {
    const chat = {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    };
    const repo = new PrismaChatRepository({ chat } as unknown as PrismaClient);
    return { repo, chat };
  }

  it('creates the chat and both members in a single nested write', async () => {
    const { repo, chat } = makeRepo();
    chat.create.mockResolvedValue({ id: 'c1', createdAt: new Date(), updatedAt: new Date(), members: [] });

    await repo.createDirectChat('user1:user2', ['user1', 'user2']);

    expect(chat.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { directKey: 'user1:user2', members: { create: [{ userId: 'user1' }, { userId: 'user2' }] } },
      }),
    );
  });

  it('turns a duplicate-key insert into UniqueConstraintError (race lost)', async () => {
    const { repo, chat } = makeRepo();
    chat.create.mockRejectedValue(known('P2002', { target: ['direct_key'] }));
    await expect(repo.createDirectChat('user1:user2', ['user1', 'user2'])).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });

  it('lists chats for a user ordered by updatedAt desc', async () => {
    const { repo, chat } = makeRepo();
    await repo.listForUser('user1');
    expect(chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: 'user1' } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('surfaces PostgreSQL outages as 503 errors', async () => {
    const { repo, chat } = makeRepo();
    chat.findUnique.mockRejectedValue(known('P1001'));
    await expect(repo.findById('c1')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
