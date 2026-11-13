import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Express body-parser errors carry `type` and `status`. */
function isBodyParserError(error: unknown): error is { type: string; status: number } {
  return typeof error === 'object' && error !== null && 'type' in error && 'status' in error;
}

/** 404 for unknown routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};

/**
 * Central error handler: every error thrown in a route (sync or async — Express 5
 * forwards rejected promises automatically) ends up here and is converted into
 * a consistent JSON shape. Internal details are logged, never leaked to clients.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  let status = 500;
  let body: ErrorBody['error'] = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

  if (error instanceof ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    };
  } else if (error instanceof AppError) {
    status = error.statusCode;
    body = { code: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
  } else if (isBodyParserError(error)) {
    status = error.status;
    body =
      error.type === 'entity.parse.failed'
        ? { code: 'INVALID_JSON', message: 'Request body is not valid JSON' }
        : error.type === 'entity.too.large'
          ? { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
          : { code: 'BAD_REQUEST', message: 'Malformed request' };
  }

  const log = req.log ?? logger;
  if (status >= 500) log.error({ err: error }, 'Request failed');
  else log.debug({ code: body.code }, 'Request rejected');

  if (requestId) body.requestId = requestId;
  res.status(status).json({ success: false, error: body } satisfies ErrorBody);
};
