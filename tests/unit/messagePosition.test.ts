import { describe, expect, it } from 'vitest';
import { compareMessagePosition, shouldAdvanceLastSeen } from '../../src/utils/messagePosition';

describe('message position ordering (used for last-seen)', () => {
  const at = (timeMicros: number, messageId: string) => ({ timeMicros, messageId });

  it('orders by time first', () => {
    expect(compareMessagePosition(at(1, 'z'), at(2, 'a'))).toBeLessThan(0);
  });

  it('breaks timestamp ties by message id, like Firestore', () => {
    expect(compareMessagePosition(at(5, 'a'), at(5, 'b'))).toBeLessThan(0);
    expect(compareMessagePosition(at(5, 'b'), at(5, 'b'))).toBe(0);
  });

  it('only advances forward', () => {
    expect(shouldAdvanceLastSeen(null, at(1, 'a'))).toBe(true);
    expect(shouldAdvanceLastSeen(at(1, 'a'), at(2, 'b'))).toBe(true);
    expect(shouldAdvanceLastSeen(at(2, 'b'), at(1, 'a'))).toBe(false);
    expect(shouldAdvanceLastSeen(at(2, 'b'), at(2, 'b'))).toBe(false);
  });
});
