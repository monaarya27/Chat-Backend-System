import { DevHeaderIdentityVerifier, FirebaseIdentityVerifier, type IdentityVerifier } from './auth/identityVerifier';
import { getPrisma } from './config/database';
import type { AppConfig } from './config/env';
import { getDb, getFirebaseAuth } from './config/firebase';
import { COLLECTIONS } from './config/constants';
import { FirestoreMessageStore } from './repositories/firestore/firestoreMessageStore';
import { InMemoryMessageStore } from './repositories/memory/inMemoryMessageStore';
import { PrismaChatRepository } from './repositories/prisma/prismaChatRepository';
import { PrismaUserRepository } from './repositories/prisma/prismaUserRepository';
import type { HealthCheck, MessageStore } from './repositories/types';
import type { RouteDependencies } from './routes';
import { ChatService } from './services/chatService';
import { MessageService } from './services/messageService';
import { UserService } from './services/userService';
import { logger } from './utils/logger';

/**
 * Chooses where messages, read receipts and last-seen pointers are stored:
 * Firestore when Firebase credentials are configured, otherwise process memory
 * (development only; config validation forbids this in production).
 */
function createMessageStore(config: AppConfig): { store: MessageStore; healthCheck: HealthCheck } {
  if (config.firebaseEnabled) {
    const db = getDb(config);
    return {
      store: new FirestoreMessageStore(db),
      healthCheck: {
        name: 'firestore',
        check: async () => void (await db.collection(COLLECTIONS.CHATS).limit(1).get()),
      },
    };
  }
  logger.warn(
    'Firebase is not configured: messages, read receipts and last seen are stored IN MEMORY ' +
      'and will be lost when the server restarts. Add Firebase credentials to .env to use Firestore.',
  );
  return {
    store: new InMemoryMessageStore(),
    healthCheck: { name: 'messages (in-memory, Firebase not configured)', check: async () => undefined },
  };
}

/**
 * Composition root: the ONLY place that knows which concrete implementations are used.
 * Swap PostgreSQL/Firestore/auth here without touching services or controllers.
 */
export function createContainer(config: AppConfig): RouteDependencies {
  const prisma = getPrisma(config.DATABASE_URL);

  const userRepository = new PrismaUserRepository(prisma);
  const chatRepository = new PrismaChatRepository(prisma);
  const { store: messageStore, healthCheck: messageStoreHealth } = createMessageStore(config);

  const chatService = new ChatService(chatRepository, userRepository);
  const messageService = new MessageService(chatService, chatRepository, messageStore, logger);
  const userService = new UserService(userRepository, chatRepository);

  // Config validation guarantees Firebase is configured when AUTH_MODE=firebase.
  const identityVerifier: IdentityVerifier =
    config.AUTH_MODE === 'firebase'
      ? new FirebaseIdentityVerifier(getFirebaseAuth(config))
      : new DevHeaderIdentityVerifier();

  return {
    userService,
    chatService,
    messageService,
    identityVerifier,
    healthChecks: [
      { name: 'postgres', check: async () => void (await prisma.$queryRaw`SELECT 1`) },
      messageStoreHealth,
    ],
  };
}
