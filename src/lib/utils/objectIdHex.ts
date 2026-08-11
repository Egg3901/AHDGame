/** MongoDB ObjectId as a 24-character hex string (case-insensitive). Shared with Zod schemas in `@/lib/api/validate`. */
export const HEX_OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

/**
 * True when `id` is exactly 24 hexadecimal characters (MongoDB ObjectId string form).
 * Does not guarantee the value is a valid ObjectId instance — use {@link parseObjectId} in
 * `@/lib/utils/objectId` when you need an instance on the server.
 *
 * This module has **no** `mongodb` dependency so it is safe to import from Client Components.
 */
export function isHexObjectIdString(id: string): boolean {
  return HEX_OBJECT_ID_REGEX.test(id);
}
