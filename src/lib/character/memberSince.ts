/**
 * Account membership outlives a character and a game reset. resolveMemberSince
 * uses the account's join date; dates at the surviving history boundary and
 * profile-only fallbacks are lower bounds because earlier history is unavailable.
 */

type StoredDate = Date | string | null | undefined;

function validDate(value: StoredDate): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function resolveMemberSince({
  accountCreatedAt,
  profileCreatedAt,
  historyStartedAt,
}: {
  accountCreatedAt: StoredDate;
  profileCreatedAt: Date;
  /** First surviving world's creation date, which ordinary resets preserve. */
  historyStartedAt?: StoredDate;
}) {
  const accountDate = validDate(accountCreatedAt);
  const date = accountDate ?? profileCreatedAt;
  const historyStart = validDate(historyStartedAt);
  // Compare UTC calendar days: opening-day accounts may have been recreated
  // hours after the world's first record. A later reset must not move this floor.
  const atHistoryBoundary =
    historyStart !== null &&
    date.toISOString().slice(0, 10) <= historyStart.toISOString().slice(0, 10);

  return { date, isApproximate: accountDate === null || atHistoryBoundary };
}
