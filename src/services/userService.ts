import type { ChatRepository, UserRepository } from '../repositories/types';
import type { Chat, User } from '../types/domain';
import { ConflictError, NotFoundError, UniqueConstraintError } from '../utils/errors';
import { assertActingAsSelf } from './authorization';

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly chats: ChatRepository,
  ) {}

  /** Registers the authenticated caller as a user (their id comes from authentication). */
  async register(actorId: string, name: string, email: string): Promise<User> {
    try {
      return await this.users.create({ id: actorId, name, email });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictError('A user with this id or email already exists', 'USER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async getById(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`, 'USER_NOT_FOUND');
    return user;
  }

  /** API 6: all chats of a user, most recently updated first. Users can only list their own chats. */
  async listChats(actorId: string, userId: string): Promise<Chat[]> {
    assertActingAsSelf(actorId, userId, 'userId');
    await this.getById(userId);
    return this.chats.listForUser(userId);
  }
}
