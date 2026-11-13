import { existsSync } from 'node:fs';
import path from 'node:path';
import { applicationDefault, cert, getApps, initializeApp, type App, type Credential } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { AppConfig } from './env';
import { logger } from '../utils/logger';

let app: App | undefined;
let firestore: Firestore | undefined;

/**
 * Chooses Firebase credentials, in priority order:
 *  1. FIRESTORE_EMULATOR_HOST set  -> no credentials needed (local emulator)
 *  2. FIREBASE_SERVICE_ACCOUNT_PATH -> service-account JSON file
 *  3. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY -> inline service account
 *  4. otherwise Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, gcloud, GCP runtime)
 */
function resolveCredential(config: AppConfig): Credential | undefined {
  if (config.FIRESTORE_EMULATOR_HOST) {
    logger.info({ host: config.FIRESTORE_EMULATOR_HOST }, 'Using Firestore emulator');
    return undefined;
  }
  if (config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const filePath = path.resolve(config.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (!existsSync(filePath)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_PATH points to "${filePath}", which does not exist. ` +
          'Download a key from Firebase Console > Project settings > Service accounts.',
      );
    }
    return cert(filePath);
  }
  if (config.FIREBASE_CLIENT_EMAIL && config.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: config.FIREBASE_PROJECT_ID,
      clientEmail: config.FIREBASE_CLIENT_EMAIL,
      // .env files store the key on one line with literal "\n" sequences.
      privateKey: config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }
  // GOOGLE_APPLICATION_CREDENTIALS is set (config validation guarantees some source exists).
  return applicationDefault();
}

/** Initializes the Firebase Admin SDK once per process. Only call when config.firebaseEnabled. */
export function getFirebaseApp(config: AppConfig): App {
  if (!config.firebaseEnabled) {
    throw new Error('Firebase is not configured (see README > Firebase project setup)');
  }
  if (!app) {
    const credential = resolveCredential(config);
    // The emulator accepts any project id; "demo-" ids never touch real Google services.
    const projectId = config.FIREBASE_PROJECT_ID ?? 'demo-chat-backend';
    app = getApps()[0] ?? initializeApp({ projectId, ...(credential ? { credential } : {}) });
  }
  return app;
}

export function getDb(config: AppConfig): Firestore {
  if (!firestore) {
    firestore = getFirestore(getFirebaseApp(config));
    // Lets us write documents that contain optional `undefined` fields safely.
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export function getFirebaseAuth(config: AppConfig): Auth {
  return getAuth(getFirebaseApp(config));
}

export async function closeFirestore(): Promise<void> {
  if (firestore) {
    await firestore.terminate();
    firestore = undefined;
  }
}
