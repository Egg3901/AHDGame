import { ObjectId } from "mongodb";
import type { User } from "@/lib/db/types/user";

/**
 * User IDs whose notifications this login may view: self plus optional linked accounts
 * (`notificationBundleUserIds` — e.g. alt logins for the same person, set via admin/ops).
 */
export function getNotificationBundleUserIds(
  user: Pick<User, "_id" | "notificationBundleUserIds">
): ObjectId[] {
  const map = new Map<string, ObjectId>();
  map.set(user._id.toString(), user._id);
  for (const id of user.notificationBundleUserIds ?? []) {
    if (id) map.set(id.toString(), id);
  }
  return Array.from(map.values());
}

/**
 * Resolve which userIds to query from optional `account` query param.
 * @param accountParam - `"all"` / omitted = all bundle; otherwise a single userId hex string
 * @returns ObjectIds to pass to `{ userId: { $in } }`, or null if invalid (caller should 400)
 */
export function resolveAccountFilter(
  accountParam: string | null,
  bundleUserIds: ObjectId[]
): { ok: true; userIds: ObjectId[] } | { ok: false } {
  const bundleSet = new Set(bundleUserIds.map((id) => id.toString()));
  if (!accountParam || accountParam === "all") {
    return { ok: true, userIds: bundleUserIds };
  }
  if (!ObjectId.isValid(accountParam) || !bundleSet.has(accountParam)) {
    return { ok: false };
  }
  return { ok: true, userIds: [new ObjectId(accountParam)] };
}

/**
 * Resolve optional `profile` query param (character id) for notification filtering.
 * @param profileParam - `"all"` / omitted = no character filter
 * @param allowedCharacterIds - character ids owned by the current notification scope (see GET handler)
 */
export function resolveCharacterProfileFilter(
  profileParam: string | null,
  allowedCharacterIds: Set<string>
): { ok: true; characterId: string | null } | { ok: false } {
  if (!profileParam || profileParam === "all") {
    return { ok: true, characterId: null };
  }
  if (!ObjectId.isValid(profileParam) || !allowedCharacterIds.has(profileParam)) {
    return { ok: false };
  }
  return { ok: true, characterId: profileParam };
}
