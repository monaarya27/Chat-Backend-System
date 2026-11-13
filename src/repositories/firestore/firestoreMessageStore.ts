import {
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { COLLECTIONS } from '../../config/constants';
import type {
  LastSeen,
  ListMessagesOptions,
  MarkReadResult,
  Message,
  MessagePage,
  UpdateLastSeenResult,
} from '../../types/domain';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { shouldAdvanceLastSeen, type MessagePosition } from '../../utils/messagePosition';
import type { MessageStore } from '../types';
import { withFirestoreErrors } from './firestoreErrors';

/**
 * Firestore layout
 *
 *   chats/{chatId}/messages/{messageId}
 *       chatId:    string
 *       senderId:  string
 *       text:      string
 *       createdAt: Timestamp            (server timestamp)
 *       readBy:    { [userId]: Timestamp }   (read receipts; map key = user, so no duplicates)
 *
 *   chats/{chatId}/lastSeen/{userId}
 *       userId, messageId, messageCreatedAt: Timestamp, seenAt: Timestamp
 *
 * Messages are a sub-collection of their chat, so "messages of chat X ordered by time"
 * is a single-field query that needs no composite index. Read receipts are stored on
 * the message itself so one page of messages is fetched with one query (in a 1:1
 * chat the map has at most one entry, so the document never grows large).
 */

interface MessageDoc {
  chatId: string;
  senderId: string;
  text: string;
  createdAt: Timestamp;
  readBy?: Record<string, Timestamp>;
}

interface LastSeenDoc {
  userId: string;
  messageId: string;
  messageCreatedAt: Timestamp;
  seenAt: Timestamp;
}

const toMicros = (ts: Timestamp): number => ts.seconds * 1_000_000 + Math.floor(ts.nanoseconds / 1000);

function toMessage(snapshot: DocumentSnapshot): Message {
  const data = snapshot.data() as MessageDoc;
  const readBy = Object.entries(data.readBy ?? {})
    .map(([userId, readAt]) => ({ userId, readAt: readAt.toDate() }))
    .sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  return {
    id: snapshot.id,
    chatId: data.chatId,
    senderId: data.senderId,
    text: data.text,
    createdAt: data.createdAt.toDate(),
    readBy,
  };
}

function toLastSeen(doc: LastSeenDoc): LastSeen {
  return {
    userId: doc.userId,
    messageId: doc.messageId,
    messageCreatedAt: doc.messageCreatedAt.toDate(),
    seenAt: doc.seenAt.toDate(),
  };
}

export class FirestoreMessageStore implements MessageStore {
  constructor(private readonly db: Firestore) {}

  private messages(chatId: string): CollectionReference {
    return this.db.collection(COLLECTIONS.CHATS).doc(chatId).collection(COLLECTIONS.MESSAGES);
  }

  private lastSeen(chatId: string): CollectionReference {
    return this.db.collection(COLLECTIONS.CHATS).doc(chatId).collection(COLLECTIONS.LAST_SEEN);
  }

  createMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    return withFirestoreErrors(async () => {
      const ref = this.messages(chatId).doc(); // Firestore generates a unique id
      await ref.set({
        chatId,
        senderId,
        text,
        createdAt: FieldValue.serverTimestamp(),
        readBy: {},
      });
      // Read back so the response contains the real server-assigned timestamp.
      return toMessage(await ref.get());
    });
  }

  getMessage(chatId: string, messageId: string): Promise<Message | null> {
    return withFirestoreErrors(async () => {
      const snapshot = await this.messages(chatId).doc(messageId).get();
      return snapshot.exists ? toMessage(snapshot) : null;
    });
  }

  listMessages(chatId: string, { limit, cursor }: ListMessagesOptions): Promise<MessagePage> {
    return withFirestoreErrors(async () => {
      const collection = this.messages(chatId);
      // Firestore breaks timestamp ties by document id, giving a stable total order.
      let query = collection.orderBy('createdAt', 'asc').limit(limit + 1);

      if (cursor) {
        const cursorSnapshot = await collection.doc(cursor).get();
        if (!cursorSnapshot.exists) {
          throw new ValidationError('cursor does not refer to a message in this chat', undefined, 'INVALID_CURSOR');
        }
        query = query.startAfter(cursorSnapshot);
      }

      const snapshot = await query.get();
      // We asked for one extra document only to learn whether another page exists.
      const hasMore = snapshot.docs.length > limit;
      const messages = snapshot.docs.slice(0, limit).map(toMessage);
      const last = messages[messages.length - 1];
      return { messages, hasMore, nextCursor: hasMore && last ? last.id : null };
    });
  }

  markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult> {
    return withFirestoreErrors(() =>
      // A transaction makes check-then-write atomic, so two concurrent "read"
      // requests cannot both write a receipt with different times.
      this.db.runTransaction(async (tx) => {
        const ref = this.messages(chatId).doc(messageId);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const existing = (snapshot.data() as MessageDoc).readBy?.[userId];
        if (existing) {
          return { receipt: { userId, readAt: existing.toDate() }, alreadyRead: true };
        }
        const readAt = Timestamp.now();
        tx.update(ref, new FieldPath('readBy', userId), readAt);
        return { receipt: { userId, readAt: readAt.toDate() }, alreadyRead: false };
      }),
    );
  }

  updateLastSeen(chatId: string, userId: string, messageId: string): Promise<UpdateLastSeenResult> {
    return withFirestoreErrors(() =>
      this.db.runTransaction(async (tx) => {
        const messageRef = this.messages(chatId).doc(messageId);
        const lastSeenRef = this.lastSeen(chatId).doc(userId);
        const [messageSnap, lastSeenSnap] = await tx.getAll(messageRef, lastSeenRef);

        if (!messageSnap?.exists) {
          throw new NotFoundError('Message not found in this chat', 'MESSAGE_NOT_FOUND');
        }
        const message = messageSnap.data() as MessageDoc;
        const current = lastSeenSnap?.exists ? (lastSeenSnap.data() as LastSeenDoc) : null;

        const candidate: MessagePosition = { timeMicros: toMicros(message.createdAt), messageId };
        const currentPosition: MessagePosition | null = current
          ? { timeMicros: toMicros(current.messageCreatedAt), messageId: current.messageId }
          : null;

        if (current && !shouldAdvanceLastSeen(currentPosition, candidate)) {
          return { lastSeen: toLastSeen(current), updated: false };
        }

        const next: LastSeenDoc = {
          userId,
          messageId,
          messageCreatedAt: message.createdAt,
          seenAt: Timestamp.now(),
        };
        tx.set(lastSeenRef, next);
        return { lastSeen: toLastSeen(next), updated: true };
      }),
    );
  }

  listLastSeen(chatId: string): Promise<LastSeen[]> {
    return withFirestoreErrors(async () => {
      const snapshot = await this.lastSeen(chatId).get();
      return snapshot.docs.map((doc) => toLastSeen(doc.data() as LastSeenDoc));
    });
  }
}
