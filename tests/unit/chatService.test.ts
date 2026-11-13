import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { buildDirectKey } from '../../src/utils/directKey';
import { FakeClock, InMemoryChatRepository, InMemoryUserRepository } from '../helpers/fakes';

async function setup() {
  const clock = new FakeClock();
  const users = new InMemoryUserRepository(clock);
  const chats = new InMemoryChatRepository(clock);
  await users.create({ id: 'a', name: 'A', email: 'a@x.io' });
  await users.create({ id: 'b', name: 'B', email: 'b@x.io' });
  return { service: new ChatService(chats, users), chats };
}

describe('buildDirectKey', () => {
  it('is independent of argument order', () => {
    expect(buildDirectKey('b', 'a')).toBe('a:b');
    expect(buildDirectKey('a', 'b')).toBe('a:b');
  });
});

describe('ChatService.createOrGetDirectChat race handling', () => {
  it('returns the winner chat when its own insert loses a race', async () => {
    const { service, chats } = await setup();
    // Simulate: another request created the chat AFTER our lookup but BEFORE our insert.
    const winner = await chats.createDirectChat('a:b', ['a', 'b']);
    const lookup = vi.spyOn(chats, 'findByDirectKey').mockResolvedValueOnce(null);

    const result = await service.createOrGetDirectChat('a', 'a', 'b');

    expect(result).toEqual({ chat: winner, created: false });
    expect(lookup).toHaveBeenCalledTimes(2); // initial lookup + re-read after the conflict
    expect(chats.chats.size).toBe(1);
  });

  it('rethrows non-conflict errors from the insert', async () => {
    const { service, chats } = await setup();
    vi.spyOn(chats, 'createDirectChat').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.createOrGetDirectChat('a', 'a', 'b')).rejects.toThrow('disk full');
  });
});
