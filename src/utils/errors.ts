/**
 * Application error hierarchy. Throw these anywhere; the central error handler
 * turns them into consistent JSON responses with the right HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, code = 'VALIDATION_ERROR') {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = 'NOT_FOUND', details?: unknown) {
    super(404, code, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(409, code, message);
  }
}

/** A dependency (PostgreSQL / Firestore) is temporarily unreachable. Clients may retry. */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

/** Infrastructure failure that is not the client's fault and not transient (e.g. bad credentials). */
export class DependencyError extends AppError {
  constructor(message: string, code = 'DEPENDENCY_ERROR') {
    super(500, code, message);
  }
}

/**
 * Raised by repositories when a unique constraint is violated. Services use it
 * to resolve races (e.g. two concurrent "create chat" requests).
 */
export class UniqueConstraintError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Unique constraint violated on: ${fields.join(', ')}`);
    this.name = 'UniqueConstraintError';
  }
}
