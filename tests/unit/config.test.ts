import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env';

const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/chat' };
const withServiceAccount = {
  ...base,
  FIREBASE_PROJECT_ID: 'demo-project',
  FIREBASE_SERVICE_ACCOUNT_PATH: './firebase/service-account.json',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ ...base });
    expect(config).toMatchObject({ NODE_ENV: 'development', PORT: 3000, AUTH_MODE: 'dev' });
  });

  it('only requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgresql:\/\//);
  });

  it('accepts both postgresql:// and postgres:// URLs', () => {
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@localhost:5432/chat' }).DATABASE_URL).toMatch(
      /^postgres:/,
    );
  });

  describe('Firebase is optional', () => {
    it('runs without Firebase in development (messages kept in memory)', () => {
      expect(loadConfig({ ...base }).firebaseEnabled).toBe(false);
    });

    it.each([
      ['a service-account file', { FIREBASE_SERVICE_ACCOUNT_PATH: './key.json', FIREBASE_PROJECT_ID: 'p' }],
      ['inline credentials', { FIREBASE_CLIENT_EMAIL: 'a@b.c', FIREBASE_PRIVATE_KEY: 'k', FIREBASE_PROJECT_ID: 'p' }],
      ['the emulator', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }],
      ['application default credentials', { GOOGLE_APPLICATION_CREDENTIALS: './adc.json', FIREBASE_PROJECT_ID: 'p' }],
    ])('enables Firestore when given %s', (_label, extra) => {
      expect(loadConfig({ ...base, ...extra }).firebaseEnabled).toBe(true);
    });

    it('treats empty values as not configured', () => {
      expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_PATH: '', FIREBASE_PROJECT_ID: '' }).firebaseEnabled).toBe(
        false,
      );
    });

    it('requires a project id with real credentials (not with the emulator)', () => {
      expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_PATH: './key.json' })).toThrow(/FIREBASE_PROJECT_ID/);
    });

    it('requires Firebase in production', () => {
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_MODE: 'firebase' })).toThrow(
        /Firebase credentials are required in production/,
      );
    });

    it('requires Firebase for AUTH_MODE=firebase', () => {
      expect(() => loadConfig({ ...base, AUTH_MODE: 'firebase' })).toThrow(/AUTH_MODE=firebase needs Firebase/);
    });
  });

  it('refuses the insecure dev auth mode in production', () => {
    expect(() => loadConfig({ ...withServiceAccount, NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
    expect(loadConfig({ ...withServiceAccount, NODE_ENV: 'production', AUTH_MODE: 'firebase' }).AUTH_MODE).toBe(
      'firebase',
    );
  });

  it('requires client email and private key together', () => {
    expect(() => loadConfig({ ...base, FIREBASE_CLIENT_EMAIL: 'svc@x.iam.gserviceaccount.com' })).toThrow(
      /FIREBASE_PRIVATE_KEY/,
    );
  });
});
