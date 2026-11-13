import type { Request, Response } from 'express';
import { currentUserId } from '../middleware/authenticate';
import type { UserService } from '../services/userService';
import { serializeChat, serializeUser } from '../utils/serializers';
import { createUserBody, userIdParams } from '../validators/schemas';

export class UserController {
  constructor(private readonly users: UserService) {}

  /** POST /users — registers the authenticated caller. */
  register = async (req: Request, res: Response): Promise<void> => {
    const { name, email } = createUserBody.parse(req.body);
    const user = await this.users.register(currentUserId(req), name, email);
    res.status(201).json({ success: true, user: serializeUser(user) });
  };

  /** GET /users/:userId */
  getById = async (req: Request, res: Response): Promise<void> => {
    const { userId } = userIdParams.parse(req.params);
    const user = await this.users.getById(userId);
    res.json({ success: true, user: serializeUser(user) });
  };

  /** GET /user/:userId/chats — API 6 */
  listChats = async (req: Request, res: Response): Promise<void> => {
    const { userId } = userIdParams.parse(req.params);
    const chats = await this.users.listChats(currentUserId(req), userId);
    res.json({ success: true, userId, count: chats.length, chats: chats.map(serializeChat) });
  };
}
