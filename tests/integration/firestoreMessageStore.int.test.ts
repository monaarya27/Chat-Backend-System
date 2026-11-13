/**
 * Runs the REAL FirestoreMessageStore against the Firebase Emulator.
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. To run:
 *   1. npm run emulators                       (terminal 1, needs Java + firebase-tools)
 *   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:integration   (terminal 2)
 */
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirestoreMessageStore } from '../../src/repositories/firestore/firestoreMessageStore';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!enabled)('FirestoreMessageStore (Firestore emulator)', () => {
  const store = () => {
    const app = getApps()[0] ?? initializeApp({ projectId: 'demo-chat-backend' });
    return new FirestoreMessageStore(getFirestore(app));
  };

  it('creates messages with server timestamps and lists them in order with pagination', async () => {
    const s = store();
    const chatId = randomUUID();
    const created = [];
    for (let i = 1; i <= 5; i++) created.push(await s.createMessage(chatId, 'u1', `m${i}`));

    const page1 = await s.listMessages(chatId, { limit: 2 });
    const page2 = await s.listMessages(chatId, { limit: 2, cursor: page1.nextCursor! });
    const page3 = await s.listMessages(chatId, { limit: 2, cursor: page2.nextCursor! });

    expect([...page1.messages, ...page2.messages, ...page3.messages].map((m) => m.text)).toEqual([
      'm1', 'm2', 'm3', 'm4', 'm5',
    ]);
    expect(page3.hasMore).toBe(false);
    expect(created[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('marks read idempotently', async () => {
    const s = store();
    const chatId = randomUUID();
    const message = await s.createMessage(chatId, 'u1', 'hi');

    const results = await Promise.all([1, 2, 3].map(() => s.markRead(chatId, message.id, 'u2')));
    expect(results.filter((r) => !r.alreadyRead)).toHaveLength(1);
    expect((await s.getMessage(chatId, message.id))!.readBy).toHaveLength(1);
  });

  it('never moves last-seen backwards', async () => {
    const s = store();
    const chatId = randomUUID();
    const older = await s.createMessage(chatId, 'u1', 'old');
    const newer = await s.createMessage(chatId, 'u1', 'new');

    await s.updateLastSeen(chatId, 'u2', newer.id);
    const result = await s.updateLastSeen(chatId, 'u2', older.id);

    expect(result.updated).toBe(false);
    expect(result.lastSeen.messageId).toBe(newer.id);
  });
});
