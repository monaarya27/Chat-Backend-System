import { describe, expect, it } from 'vitest';
import { translateFirestoreError, withFirestoreErrors } from '../../src/repositories/firestore/firestoreErrors';
import { AppError, NotFoundError } from '../../src/utils/errors';

const grpcError = (code: number) => Object.assign(new Error(`grpc ${code}`), { code });

describe('translateFirestoreError', () => {
  it.each([4, 8, 10, 14])('maps transient gRPC code %i to 503', (code) => {
    const error = translateFirestoreError(grpcError(code)) as AppError;
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('FIRESTORE_UNAVAILABLE');
  });

  it.each([7, 16])('maps auth gRPC code %i to FIRESTORE_AUTH_ERROR', (code) => {
    const error = translateFirestoreError(grpcError(code)) as AppError;
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('FIRESTORE_AUTH_ERROR');
  });

  it('explains missing credentials', () => {
    const error = translateFirestoreError(new Error('Could not load the default credentials')) as AppError;
    expect(error.code).toBe('FIRESTORE_AUTH_ERROR');
  });

  it('maps a missing Firestore database (gRPC 5) to a helpful error', () => {
    const error = translateFirestoreError(grpcError(5)) as AppError;
    expect(error.message).toMatch(/Create a Firestore database/);
  });

  it('keeps application errors thrown inside transactions', async () => {
    const notFound = new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
    await expect(withFirestoreErrors(() => Promise.reject(notFound))).rejects.toBe(notFound);
  });
});
