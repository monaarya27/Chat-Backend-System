import type { PrismaClient } from '@prisma/client';
import type { CreateUserInput, User } from '../../types/domain';
import type { UserRepository } from '../types';
import { withPrismaErrors } from './prismaErrors';

const userSelect = { id: true, name: true, email: true, createdAt: true, updatedAt: true } as const;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<User | null> {
    return withPrismaErrors(() => this.prisma.user.findUnique({ where: { id }, select: userSelect }));
  }

  findManyByIds(ids: string[]): Promise<User[]> {
    return withPrismaErrors(() =>
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect }),
    );
  }

  create(input: CreateUserInput): Promise<User> {
    return withPrismaErrors(() => this.prisma.user.create({ data: input, select: userSelect }));
  }
}
