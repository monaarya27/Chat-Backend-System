import { AppError, DependencyError, ServiceUnavailableError } from '../../utils/errors';

/** gRPC status codes returned by the Firestore client. */
const GRPC = {
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  ABORTED: 10,
  UNAVAILABLE: 14,
  UNAUTHENTICATED: 16,
} as const;

const TRANSIENT = new Set<number>([
  GRPC.DEADLINE_EXCEEDED,
  GRPC.RESOURCE_EXHAUSTED,
  GRPC.ABORTED,
  GRPC.UNAVAILABLE,
]);

function grpcCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    if (typeof code === 'number') return code;
  }
  return undefined;
}

/** Converts Firestore/Google client errors into application errors. */
export function translateFirestoreError(error: unknown): Error {
  if (error instanceof AppError) return error;

  const code = grpcCode(error);
  if (code !== undefined && TRANSIENT.has(code)) {
    return new ServiceUnavailableError('Firestore is currently unavailable', 'FIRESTORE_UNAVAILABLE');
  }
  if (code === GRPC.PERMISSION_DENIED || code === GRPC.UNAUTHENTICATED) {
    return new DependencyError(
      'Firestore rejected the server credentials. Check the Firebase service account configuration.',
      'FIRESTORE_AUTH_ERROR',
    );
  }
  if (code === GRPC.NOT_FOUND) {
    return new DependencyError(
      'Firestore database not found. Create a Firestore database in the Firebase Console.',
      'FIRESTORE_ERROR',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/credential/i.test(message)) {
    return new DependencyError(
      'Firebase credentials are missing or invalid. See README > Firebase project setup.',
      'FIRESTORE_AUTH_ERROR',
    );
  }
  return new DependencyError('Firestore request failed', 'FIRESTORE_ERROR');
}

/** Runs a Firestore operation and translates any thrown error. */
export async function withFirestoreErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translateFirestoreError(error);
  }
}
