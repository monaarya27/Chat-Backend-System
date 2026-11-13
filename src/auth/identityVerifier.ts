import type { Request } from 'express';
import type { Auth } from 'firebase-admin/auth';
import { UnauthorizedError } from '../utils/errors';
import { ID_PATTERN } from '../validators/common';
import { LIMITS } from '../config/constants';

export interface VerifiedIdentity {
  userId: string;
  method: 'dev-header' | 'firebase';
}

/** Strategy that turns an incoming request into a verified user identity. */
export interface IdentityVerifier {
  verify(req: Request): Promise<VerifiedIdentity>;
}

export const DEV_USER_HEADER = 'x-user-id';

/**
 * DEVELOPMENT ONLY. Trusts the `X-User-Id` header as the caller's identity.
 * Anyone can impersonate anyone with this, which is why config validation
 * refuses AUTH_MODE=dev when NODE_ENV=production.
 */
export class DevHeaderIdentityVerifier implements IdentityVerifier {
  async verify(req: Request): Promise<VerifiedIdentity> {
    const raw = req.header(DEV_USER_HEADER)?.trim();
    if (!raw) {
      throw new UnauthorizedError(
        'Missing X-User-Id header. In AUTH_MODE=dev every request must send "X-User-Id: <your user id>". ' +
          'For POST /users it is the id of the user being registered (e.g. user4). ' +
          'In Swagger, click Authorize and enter it under devUserId.',
      );
    }
    if (raw.length > LIMITS.ID_MAX_LENGTH || !ID_PATTERN.test(raw)) {
      throw new UnauthorizedError(
        `Invalid X-User-Id header: use 1-${LIMITS.ID_MAX_LENGTH} letters, digits, "_" or "-" (e.g. user4)`,
      );
    }
    return { userId: raw, method: 'dev-header' };
  }
}

/**
 * Production strategy. Expects `Authorization: Bearer <Firebase ID token>`.
 * The token is verified (signature, expiry, audience, revocation) by the Firebase
 * Admin SDK, and its `uid` is used as the user id in PostgreSQL.
 */
export class FirebaseIdentityVerifier implements IdentityVerifier {
  constructor(private readonly auth: Auth) {}

  async verify(req: Request): Promise<VerifiedIdentity> {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedError(
        'Missing "Authorization: Bearer <Firebase ID token>" header (AUTH_MODE=firebase). ' +
          'For POST /users the new user\'s id is the token\'s uid.',
      );
    }
    try {
      const decoded = await this.auth.verifyIdToken(match[1], true);
      return { userId: decoded.uid, method: 'firebase' };
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }
}
