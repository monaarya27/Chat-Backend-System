import type { Request } from 'express';
import type { Auth } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import { DevHeaderIdentityVerifier, FirebaseIdentityVerifier } from '../../src/auth/identityVerifier';
import { UnauthorizedError } from '../../src/utils/errors';

const fakeRequest = (headers: Record<string, string>) =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe('FirebaseIdentityVerifier', () => {
  it('uses the uid of a valid ID token (and checks revocation)', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({ uid: 'firebase-uid-1' });
    const verifier = new FirebaseIdentityVerifier({ verifyIdToken } as unknown as Auth);

    const identity = await verifier.verify(fakeRequest({ authorization: 'Bearer good-token' }));

    expect(identity).toEqual({ userId: 'firebase-uid-1', method: 'firebase' });
    expect(verifyIdToken).toHaveBeenCalledWith('good-token', true);
  });

  it('rejects an invalid token with 401', async () => {
    const verifier = new FirebaseIdentityVerifier({
      verifyIdToken: vi.fn().mockRejectedValue(new Error('expired')),
    } as unknown as Auth);
    await expect(verifier.verify(fakeRequest({ authorization: 'Bearer bad' }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a missing Authorization header with 401', async () => {
    const verifier = new FirebaseIdentityVerifier({ verifyIdToken: vi.fn() } as unknown as Auth);
    await expect(verifier.verify(fakeRequest({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('DevHeaderIdentityVerifier', () => {
  it('reads X-User-Id', async () => {
    const identity = await new DevHeaderIdentityVerifier().verify(fakeRequest({ 'x-user-id': 'user1' }));
    expect(identity).toEqual({ userId: 'user1', method: 'dev-header' });
  });

  it('rejects a missing header', async () => {
    await expect(new DevHeaderIdentityVerifier().verify(fakeRequest({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
