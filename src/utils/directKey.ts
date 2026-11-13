/**
 * Builds the canonical key for a one-to-one chat. Sorting makes the key the same
 * regardless of who starts the chat: buildDirectKey('b', 'a') === buildDirectKey('a', 'b').
 * User ids are validated to never contain ':' so the key is unambiguous.
 */
export function buildDirectKey(userAId: string, userBId: string): string {
  return [userAId, userBId].sort().join(':');
}
