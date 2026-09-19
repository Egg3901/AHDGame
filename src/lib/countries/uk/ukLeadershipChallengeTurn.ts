import type { Db } from "mongodb";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { processExpiredLeadershipChallenges } from "@/lib/uk/leadership/leadershipCommands";

export interface UkLeadershipChallengeTurnResult {
  expired: number;
  resolved: number;
  removed: number;
}

const EMPTY: UkLeadershipChallengeTurnResult = { expired: 0, resolved: 0, removed: 0 };

/**
 * UK party-leadership challenge turn driver (ticket #861).
 *
 * Expires gathering challenges that never reached their trigger threshold
 * and resolves ballots past their closing turn. UK-gated: a cheap no-op on
 * worlds without a registered UK. Every resolve path is idempotent
 * (atomic status-claim), so reruns and retries cannot double-apply.
 */
export async function processUkLeadershipChallengeTurn(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<UkLeadershipChallengeTurnResult> {
  const registered = new Set(await getRegisteredCountryIds(db));
  if (!registered.has("UK")) return { ...EMPTY };
  return processExpiredLeadershipChallenges(db, "UK", now, currentTurn);
}
