import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { buildRouter, type RouteDependencies } from './routes';
import { logger } from './utils/logger';

/**
 * Builds the Express app from already-constructed dependencies.
 * It never connects to databases itself, which lets tests pass in fakes.
 */
export function createApp(deps: RouteDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      // Swagger UI is served over plain http locally; don't force its assets onto https.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use(buildRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
