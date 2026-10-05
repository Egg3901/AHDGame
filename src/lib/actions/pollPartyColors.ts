import type { Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";

/** Neutral fallback for independents, NPPs and parties with no stored color. */
export const POLL_NEUTRAL_PARTY_COLOR = "#9CA3AF";

const LEGACY_PARTY_COLORS: Record<string, string> = {
  democrat: "#3b82f6",
  republican: "#ef4444",
};

/**
 * Pure: map every requested party id to a display hex. Stored party rows win,
 * legacy named parties get their traditional color, everything else is neutral.
 */
export function resolvePollPartyColors(
  partyIds: ReadonlyArray<string | null | undefined>,
  parties: ReadonlyArray<Pick<PoliticalParty, "sequentialId" | "color">>
): Record<string, string> {
  const bySeq = new Map(parties.map((p) => [String(p.sequentialId), p.color]));
  const out: Record<string, string> = {};
  for (const id of partyIds) {
    if (!id || id in out) continue;
    out[id] = bySeq.get(id) || LEGACY_PARTY_COLORS[id] || POLL_NEUTRAL_PARTY_COLOR;
  }
  return out;
}

/** Load the colors for the parties a poll shows (the player's and each rival's). */
export async function loadPollPartyColors(
  db: Db,
  countryId: string,
  partyIds: ReadonlyArray<string | null | undefined>
): Promise<Record<string, string>> {
  const numeric = Array.from(new Set(partyIds.filter((p): p is string => !!p && /^\d+$/.test(p))));
  let parties: Pick<PoliticalParty, "sequentialId" | "color">[] = [];
  if (numeric.length > 0) {
    try {
      parties = await db
        .collection<PoliticalParty>("politicalParties")
        .find(
          {
            countryId: countryId as PoliticalParty["countryId"],
            sequentialId: { $in: numeric.map(Number) },
          },
          { projection: { sequentialId: 1, color: 1 } }
        )
        .toArray();
    } catch {
      parties = [];
    }
  }
  return resolvePollPartyColors(partyIds, parties);
}
