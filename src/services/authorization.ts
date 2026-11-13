import { ForbiddenError } from '../utils/errors';

/**
 * The request body names a user (e.g. senderId). The authenticated caller may
 * only act as themselves, so the two must match. This stops user A from sending
 * messages or marking reads on behalf of user B.
 */
export function assertActingAsSelf(actorId: string, claimedUserId: string, field: string): void {
  if (actorId !== claimedUserId) {
    throw new ForbiddenError(
      `${field} must match the authenticated user`,
      'IDENTITY_MISMATCH',
    );
  }
}
