import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { IdentityVerifier } from '../auth/identityVerifier';
import { UnauthorizedError } from '../utils/errors';

/** Verifies the caller's identity and stores it on `req.auth`. */
export function authenticate(verifier: IdentityVerifier): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.auth = await verifier.verify(req);
    next();
  };
}

/** Returns the authenticated user id (throws 401 if `authenticate` did not run). */
export function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}
