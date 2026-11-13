import { Prisma } from '@prisma/client';
import { AppError, DependencyError, ServiceUnavailableError, UniqueConstraintError } from '../../utils/errors';

/**
 * Prisma error codes that mean "PostgreSQL is unreachable or overloaded" — the
 * request may succeed if retried, so we answer 503.
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
const CONNECTIVITY_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** Converts low-level Prisma errors into application errors with sensible HTTP semantics. */
export function translatePrismaError(error: unknown): Error {
  if (error instanceof AppError || error instanceof UniqueConstraintError) return error;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [String(target ?? 'unknown')];
      return new UniqueConstraintError(fields);
    }
    if (CONNECTIVITY_CODES.has(error.code)) {
      return new ServiceUnavailableError('The PostgreSQL database is currently unavailable', 'DATABASE_UNAVAILABLE');
    }
    return new DependencyError(`PostgreSQL request failed (${error.code})`, 'DATABASE_ERROR');
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new ServiceUnavailableError('Could not connect to the PostgreSQL database', 'DATABASE_UNAVAILABLE');
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return new DependencyError('PostgreSQL request failed', 'DATABASE_ERROR');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Runs a Prisma operation and translates any thrown error. */
export async function withPrismaErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translatePrismaError(error);
  }
}
