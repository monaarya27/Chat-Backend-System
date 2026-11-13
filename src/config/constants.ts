/** Business limits used by validators and services. */
export const LIMITS = {
  /** Max characters in one message. */
  MESSAGE_MAX_LENGTH: 2000,
  /** Messages returned when `limit` is not provided. */
  MESSAGES_DEFAULT_PAGE_SIZE: 50,
  /** Hard cap on `limit` to protect Firestore read costs and response size. */
  MESSAGES_MAX_PAGE_SIZE: 100,
  /** Firebase Auth uids are at most 128 characters. */
  ID_MAX_LENGTH: 128,
} as const;

/** Firestore collection names in one place. */
export const COLLECTIONS = {
  CHATS: 'chats',
  MESSAGES: 'messages',
  LAST_SEEN: 'lastSeen',
} as const;
