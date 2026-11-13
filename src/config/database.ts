import { PrismaClient, type Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

type LoggingPrismaClient = PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>;

let prisma: LoggingPrismaClient | undefined;

/**
 * Returns the single shared PrismaClient. Prisma keeps a connection pool
 * internally, so one instance per process is the recommended setup.
 * Pool size can be tuned with `?connection_limit=10` on DATABASE_URL.
 */
export function getPrisma(databaseUrl: string): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>({
      datasources: { db: { url: databaseUrl } },
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
    prisma.$on('warn', (event) => logger.warn({ prisma: event }, 'Prisma warning'));
    prisma.$on('error', (event) => logger.error({ prisma: event }, 'Prisma error'));
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
