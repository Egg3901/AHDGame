import type { Db, ObjectId } from "mongodb";
import type { User } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";

// Letters (any script), digits, spaces, and basic punctuation. Em dashes and
// en dashes are deliberately excluded per site copy rules; plain hyphens are fine.
const NAME_CHARSET_REGEX = /^[\p{L}\p{N} .,'"&()!?:;_-]+$/u;
const FORBIDDEN_DASH_REGEX = /[–—]/;

/**
 * Validate a proposed supporter-facing name (wall name or NPP name).
 * Returns the trimmed name on success or an error message string.
 */
export function validateProposedName(
  raw: string,
  opts: { minLen: number; maxLen: number }
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < opts.minLen || name.length > opts.maxLen) {
    return {
      ok: false,
      error: `Name must be between ${opts.minLen} and ${opts.maxLen} characters.`,
    };
  }
  if (FORBIDDEN_DASH_REGEX.test(name)) {
    return { ok: false, error: "Name cannot contain em dashes or en dashes." };
  }
  if (!NAME_CHARSET_REGEX.test(name)) {
    return {
      ok: false,
      error: "Name can only contain letters, numbers, spaces, and basic punctuation.",
    };
  }
  return { ok: true, name };
}

/**
 * Impersonation guard: true when another user's username or displayName matches
 * the candidate name case-insensitively. `excludeUserId` skips the requester's
 * own account.
 */
export async function nameCollidesWithUser(
  db: Db,
  name: string,
  excludeUserId?: ObjectId
): Promise<boolean> {
  const exact = new RegExp(`^${escapeRegex(name)}$`, "i");
  const other = await db.collection<User>("users").findOne(
    {
      $and: [
        { $or: [{ username: exact }, { displayName: exact }] },
        ...(excludeUserId ? [{ _id: { $ne: excludeUserId } }] : []),
      ],
    },
    { projection: { _id: 1 } }
  );
  return other !== null;
}
