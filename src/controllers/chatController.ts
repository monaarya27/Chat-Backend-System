import type { Request, Response } from 'express';
import { currentUserId } from '../middleware/authenticate';
import type { ChatService } from '../services/chatService';
import type { MessageService } from '../services/messageService';
import { serializeChat, serializeLastSeen, serializeMessage } from '../utils/serializers';
import {
  chatIdParams,
  chatMessageParams,
  createChatBody,
  getMessagesQuery,
  markReadBody,
  sendMessageBody,
  updateLastSeenBody,
} from '../validators/schemas';

/**
 * Controllers are intentionally thin: validate input, call a service, shape the
 * response. Zod `.parse` throws on bad input and the error handler returns 400.
 */
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly messages: MessageService,
  ) {}

  /** POST /chat/create — API 1 */
  createOrGet = async (req: Request, res: Response): Promise<void> => {
    const { userAId, userBId } = createChatBody.parse(req.body);
    const { chat, created } = await this.chats.createOrGetDirectChat(currentUserId(req), userAId, userBId);
    res.status(created ? 201 : 200).json({
      success: true,
      chatId: chat.id,
      created,
      chat: serializeChat(chat),
    });
  };

  /** POST /chat/:chatId/message/send — API 2 */
  sendMessage = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = chatIdParams.parse(req.params);
    const { senderId, text } = sendMessageBody.parse(req.body);
    const message = await this.messages.send(currentUserId(req), chatId, senderId, text);
    res.status(201).json({ success: true, message: serializeMessage(message) });
  };

  /** GET /chat/:chatId/messages?limit=50&cursor=<messageId> — API 3 */
  getMessages = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = chatIdParams.parse(req.params);
    const { limit, cursor } = getMessagesQuery.parse(req.query);
    const page = await this.messages.list(currentUserId(req), chatId, limit, cursor);
    res.json({
      success: true,
      chatId,
      messages: page.messages.map(serializeMessage),
      pagination: { limit, count: page.messages.length, hasMore: page.hasMore, nextCursor: page.nextCursor },
    });
  };

  /** POST /chat/:chatId/message/:messageId/read — API 4 */
  markRead = async (req: Request, res: Response): Promise<void> => {
    const { chatId, messageId } = chatMessageParams.parse(req.params);
    const { userId } = markReadBody.parse(req.body);
    const { receipt, alreadyRead } = await this.messages.markRead(currentUserId(req), chatId, messageId, userId);
    res.json({
      success: true,
      alreadyRead,
      receipt: { chatId, messageId, userId: receipt.userId, readAt: receipt.readAt.toISOString() },
    });
  };

  /** POST /chat/:chatId/lastseen — API 5 */
  updateLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = chatIdParams.parse(req.params);
    const { userId, messageId } = updateLastSeenBody.parse(req.body);
    const { lastSeen, updated } = await this.messages.updateLastSeen(currentUserId(req), chatId, userId, messageId);
    res.json({ success: true, updated, lastSeen: serializeLastSeen(lastSeen) });
  };

  /** GET /chat/:chatId/lastseen — last-seen pointers of every member */
  listLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { chatId } = chatIdParams.parse(req.params);
    const entries = await this.messages.listLastSeen(currentUserId(req), chatId);
    res.json({ success: true, chatId, lastSeen: entries.map(serializeLastSeen) });
  };
}
