/**
 * Phase 11b — legislator favorability impact based on their vote and ideology.
 *
 * After a chamber tallies, each legislator who voted gets a favorability
 * delta calibrated to whether their vote ALIGNED with their ideology's
 * preferences. Voting "for" a path your base loves is rewarded; voting
 * "for" a path your base hates is punished. Voting "against" yields half
 * the magnitude of the inverse (opposing is less politically active than
 * aligning).
 *
 * Ideology mapping derives from Phase 10's `deriveIdeology`. Player
 * Characters lack a known ideology — they fall through to AVERAGE_DELTAS
 * (path's general unpopularity, no ideology adjustment).
 */

import { ObjectId, type Db } from "mongodb";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import type { Character } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import type { NpcIdeology } from "../npc/npcConstants";

type AlignmentTable = Record<SovereignResolutionChoice, number>;

const ALIGNED_DELTAS: Record<NpcIdeology, AlignmentTable> = {
  populist: { bailout: -3, restructure: -2, monetize: 5, repudiate: 8 },
  nationalist: { bailout: -3, restructure: -2, monetize: 3, repudiate: 10 },
  technocrat: { bailout: 5, restructure: 8, monetize: -3, repudiate: -10 },
  centrist: { bailout: 2, restructure: 3, monetize: 0, repudiate: -3 },
  socialist: { bailout: -1, restructure: -1, monetize: 5, repudiate: 3 },
  conservative: { bailout: 5, restructure: 5, monetize: -5, repudiate: -8 },
};

/**
 * Average across ideologies — used when a voter's ideology is unknown
 * (e.g. player Characters). Reflects the path's general "popularity" net
 * of partisan effects.
 */
const AVERAGE_DELTAS: AlignmentTable = (() => {
  const ideos = Object.keys(ALIGNED_DELTAS) as NpcIdeology[];
  const out: AlignmentTable = { bailout: 0, restructure: 0, monetize: 0, repudiate: 0 };
  for (const ideo of ideos) {
    for (const k of Object.keys(out) as SovereignResolutionChoice[]) {
      out[k] += ALIGNED_DELTAS[ideo][k];
    }
  }
  for (const k of Object.keys(out) as SovereignResolutionChoice[]) {
    out[k] = out[k] / ideos.length;
  }
  return out;
})();

/**
 * Pure: compute the favorability delta for one legislator given their
 * ideology, their vote ("for"/"against"), and the resolution path that
 * was on the table.
 *
 * "for" → aligned table value.
 * "against" → -aligned/2 (opposing is less politically active than aligning).
 */
export function computeLegislatorImpact(
  ideology: NpcIdeology | "unknown",
  vote: "for" | "against",
  choice: SovereignResolutionChoice
): number {
  const table = ideology === "unknown" ? AVERAGE_DELTAS : ALIGNED_DELTAS[ideology];
  const aligned = table[choice];
  return vote === "for" ? aligned : -aligned / 2;
}

interface LegislatorImpactInputs {
  votes: Record<string, "for" | "against">;
  choice: SovereignResolutionChoice;
  npps: Map<string, Pick<NPP, "_id" | "policies">>;
  characterIds: Set<string>;
  ideologyResolver: (npp: Pick<NPP, "policies">) => NpcIdeology;
}

/**
 * Apply favorability deltas to a chamber's voters at tally time.
 * Bulk-writes per-NPP and per-Character `$inc favorability`.
 *
 * NPPs use their derived ideology (via Phase 10's `deriveIdeology`).
 * Characters fall through to AVERAGE_DELTAS since we don't track Character
 * ideology inline.
 */
export async function applyLegislatorImpacts(
  db: Db,
  input: LegislatorImpactInputs
): Promise<{ npcsAffected: number; charactersAffected: number }> {
  const { votes, choice, npps, characterIds, ideologyResolver } = input;
  let npcsAffected = 0;
  let charactersAffected = 0;

  const nppOps: Array<{ id: ObjectId; delta: number }> = [];
  const charOps: Array<{ id: ObjectId; delta: number }> = [];

  for (const [voterIdStr, vote] of Object.entries(votes)) {
    const npp = npps.get(voterIdStr);
    if (npp) {
      const ideology = ideologyResolver(npp);
      const delta = computeLegislatorImpact(ideology, vote, choice);
      if (delta !== 0) {
        nppOps.push({ id: npp._id, delta });
        npcsAffected++;
      }
    } else if (characterIds.has(voterIdStr)) {
      const delta = computeLegislatorImpact("unknown", vote, choice);
      if (delta !== 0) {
        charOps.push({ id: new ObjectId(voterIdStr), delta });
        charactersAffected++;
      }
    }
  }

  if (nppOps.length > 0) {
    await db.collection<NPP>("npps").bulkWrite(
      nppOps.map((op) => ({
        updateOne: {
          filter: { _id: op.id },
          update: { $inc: { favorability: op.delta } },
        },
      }))
    );
  }
  if (charOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(
      charOps.map((op) => ({
        updateOne: {
          filter: { _id: op.id },
          update: { $inc: { favorability: op.delta } },
        },
      }))
    );
  }

  return { npcsAffected, charactersAffected };
}
