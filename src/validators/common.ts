import { z } from 'zod';
import { LIMITS } from '../config/constants';

/**
 * Ids (users, chats, messages) may only contain letters, digits, "_" and "-".
 * This covers UUIDs, Firestore auto-ids and Firebase Auth uids, and guarantees
 * ids never contain ":" (used in chat direct keys) or "." / "/" (special in Firestore).
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Required id field with readable error messages, e.g. idField('senderId').
 * `docs` becomes the field's description/example in the Swagger docs, which are
 * generated from these schemas (src/docs/openapi.ts).
 */
export const idField = (name: string, docs: { description?: string; example?: string } = {}) =>
  z
    .string({
      error: (issue) => (issue.input === undefined ? `${name} is required` : `${name} must be a string`),
    })
    .trim()
    .min(1, `${name} is required`)
    .max(LIMITS.ID_MAX_LENGTH, `${name} must be at most ${LIMITS.ID_MAX_LENGTH} characters`)
    .regex(ID_PATTERN, `${name} may only contain letters, digits, "_" and "-"`)
    .meta(docs);
