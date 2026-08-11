import { isPatreonActive, type PatreonTier } from "@/lib/db/types";

function patreonExpiresAtToDate(
  expiresAt: Date | string | null | undefined
): Date | null | undefined {
  if (expiresAt == null) return expiresAt;
  return expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
}

/** Active supporter accounts (any paid tier) or admins may upload animated GIF profile pictures. */
export function canUploadGifAvatar(
  tier: PatreonTier,
  expiresAt?: Date | string | null,
  isAdmin?: boolean
): boolean {
  if (isAdmin) return true;
  const d = patreonExpiresAtToDate(expiresAt);
  if (!isPatreonActive(tier, d ?? null)) return false;
  return tier === "supporter" || tier === "supporter-plus" || tier === "supporter-plus-plus";
}
