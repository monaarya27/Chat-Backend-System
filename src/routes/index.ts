import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from '../docs/openapi';
import type { IdentityVerifier } from '../auth/identityVerifier';
import { ChatController } from '../controllers/chatController';
import { HealthController } from '../controllers/healthController';
import { UserController } from '../controllers/userController';
import { authenticate } from '../middleware/authenticate';
import type { HealthCheck } from '../repositories/types';
import type { ChatService } from '../services/chatService';
import type { MessageService } from '../services/messageService';
import type { UserService } from '../services/userService';

export interface RouteDependencies {
  userService: UserService;
  chatService: ChatService;
  messageService: MessageService;
  identityVerifier: IdentityVerifier;
  healthChecks: HealthCheck[];
}

export function buildRouter(deps: RouteDependencies): Router {
  const router = Router();
  const users = new UserController(deps.userService);
  const chats = new ChatController(deps.chatService, deps.messageService);
  const health = new HealthController(deps.healthChecks);

  // Public endpoints
  router.get('/health', health.live);
  router.get('/health/ready', health.ready);

  // API documentation (Swagger UI + raw OpenAPI JSON)
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'Chat Backend API Docs',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );

  // Everything below requires a verified identity
  router.use(authenticate(deps.identityVerifier));

  // User management
  router.post('/users', users.register);
  router.get('/users/:userId', users.getById);
  router.get('/user/:userId/chats', users.listChats); // API 6

  // Chats & messages
  router.post('/chat/create', chats.createOrGet); // API 1
  router.post('/chat/:chatId/message/send', chats.sendMessage); // API 2
  router.get('/chat/:chatId/messages', chats.getMessages); // API 3
  router.post('/chat/:chatId/message/:messageId/read', chats.markRead); // API 4
  router.post('/chat/:chatId/lastseen', chats.updateLastSeen); // API 5
  router.get('/chat/:chatId/lastseen', chats.listLastSeen);

  return router;
}
