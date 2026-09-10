import type { UserPayload } from "@/lib/auth";

/** Check a verified session against the fresh account snapshot used for a credential write. */
export function credentialSessionIsCurrent(
  userId: string,
  account: { isBanned?: unknown; authRevokedAt?: unknown },
  payload: UserPayload | null
): boolean {
  if (
    !payload ||
    payload.userId !== userId ||
    !Number.isSafeInteger(payload.iat) ||
    typeof payload.iat !== "number" ||
    payload.iat < 0 ||
    account.isBanned === true
  )
    return false;
  const cutoff = account.authRevokedAt;
  if (cutoff === undefined || cutoff === null) return true;
  return (
    cutoff instanceof Date &&
    Number.isFinite(cutoff.getTime()) &&
    cutoff.getTime() < payload.iat * 1000
  );
}
