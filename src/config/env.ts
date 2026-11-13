import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

/**
 * Firebase counts as configured when ANY credential source is provided:
 * the emulator, a service-account file, inline service-account fields, or
 * Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
 */
function hasFirebaseCredentials(env: {
  FIRESTORE_EMULATOR_HOST?: string | undefined;
  FIREBASE_SERVICE_ACCOUNT_PATH?: string | undefined;
  FIREBASE_CLIENT_EMAIL?: string | undefined;
  FIREBASE_PRIVATE_KEY?: string | undefined;
  GOOGLE_APPLICATION_CREDENTIALS?: string | undefined;
}): boolean {
  return Boolean(
    env.FIRESTORE_EMULATOR_HOST ||
      env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) ||
      env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required (postgresql://USER:PASSWORD@HOST:PORT/DB)' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgresql:// or postgres://'),
    // All Firebase settings are optional. Without them, messages are kept in memory (dev only).
    FIREBASE_PROJECT_ID: optionalString,
    FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
    FIREBASE_CLIENT_EMAIL: optionalString,
    FIREBASE_PRIVATE_KEY: optionalString,
    FIRESTORE_EMULATOR_HOST: optionalString,
    GOOGLE_APPLICATION_CREDENTIALS: optionalString,
    AUTH_MODE: z.enum(['dev', 'firebase']).default('dev'),
  })
  .superRefine((env, ctx) => {
    const firebaseConfigured = hasFirebaseCredentials(env);

    if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'dev') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is insecure and not allowed when NODE_ENV=production',
      });
    }
    if (Boolean(env.FIREBASE_CLIENT_EMAIL) !== Boolean(env.FIREBASE_PRIVATE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_PRIVATE_KEY'],
        message: 'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together',
      });
    }
    if (env.NODE_ENV === 'production' && !firebaseConfigured) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_SERVICE_ACCOUNT_PATH'],
        message: 'Firebase credentials are required in production (in-memory message storage is for development only)',
      });
    }
    if (env.AUTH_MODE === 'firebase' && !firebaseConfigured) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=firebase needs Firebase credentials; use AUTH_MODE=dev until they are configured',
      });
    }
    if (firebaseConfigured && !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_PROJECT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_PROJECT_ID'],
        message: 'FIREBASE_PROJECT_ID is required when Firebase credentials are configured',
      });
    }
  })
  .transform((env) => ({ ...env, firebaseEnabled: hasFirebaseCredentials(env) }));

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables. Throws a readable error listing
 * every missing/invalid variable so misconfiguration is caught at startup,
 * not on the first request.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return result.data;
}
