/**
 * Position of a message in a chat's timeline. Firestore orders messages by
 * `createdAt` and then by document id, so we compare the same way.
 * `timeMicros` keeps Firestore's microsecond precision (fits safely in a JS number).
 */
export interface MessagePosition {
  timeMicros: number;
  messageId: string;
}

/** Negative if a is before b, 0 if same position, positive if a is after b. */
export function compareMessagePosition(a: MessagePosition, b: MessagePosition): number {
  if (a.timeMicros !== b.timeMicros) return a.timeMicros < b.timeMicros ? -1 : 1;
  if (a.messageId === b.messageId) return 0;
  return a.messageId < b.messageId ? -1 : 1;
}

/** Last-seen may only move forward: true only if `candidate` is strictly after `current`. */
export function shouldAdvanceLastSeen(
  current: MessagePosition | null,
  candidate: MessagePosition,
): boolean {
  return current === null || compareMessagePosition(candidate, current) > 0;
}
