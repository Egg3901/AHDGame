import { isTokenRevokedByCutoff } from "@/lib/auth/revocationCutoff";
import type { UserPayload } from "@/lib/auth";
import { isAuthMigrationFenced } from "@/lib/auth/sourceFence";

/** Check a verified session against the fresh account snapshot used for a credential write. */
export function credentialSessionIsCurrent(
  userId: string,
  account: { isBanned?: unknown; authRevokedAt?: unknown; authMigrationFence?: unknown },
  payload: UserPayload | null
): boolean {
  if (
    !payload ||
    payload.userId !== userId ||
    !Number.isSafeInteger(payload.iat) ||
    typeof payload.iat !== "number" ||
    payload.iat < 0 ||
    account.isBanned === true ||
    isAuthMigrationFenced(account)
  )
    return false;
  return !isTokenRevokedByCutoff(account.authRevokedAt, payload.iat);
}
