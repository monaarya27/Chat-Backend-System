import type { Server } from 'node:http';
import { createApp } from './app';
import { getPrisma, disconnectPrisma } from './config/database';
import { loadConfig } from './config/env';
import { closeFirestore } from './config/firebase';
import { createContainer } from './container';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.AUTH_MODE === 'dev') {
    logger.warn('AUTH_MODE=dev: identity comes from the X-User-Id header. Never use this in production.');
  }

  const deps = createContainer(config);

  // Fail fast with a clear message if PostgreSQL is not reachable.
  try {
    await getPrisma(config.DATABASE_URL).$connect();
    logger.info('Connected to PostgreSQL');
  } catch (error) {
    logger.fatal({ err: error }, 'Could not connect to PostgreSQL. Check DATABASE_URL and that PostgreSQL is running.');
    process.exit(1);
  }

  const app = createApp(deps);
  const server: Server = app.listen(config.PORT, () => {
    logger.info(`Chat backend listening on http://localhost:${config.PORT} (env=${config.NODE_ENV})`);
  });

  // Graceful shutdown: stop accepting requests, then close database clients.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void Promise.allSettled([disconnectPrisma(), closeFirestore()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

main().catch((error: unknown) => {
  logger.fatal({ err: error }, error instanceof Error ? error.message : 'Startup failed');
  process.exit(1);
});
