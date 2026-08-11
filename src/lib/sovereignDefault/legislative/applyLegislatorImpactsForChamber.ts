/**
 * Phase 11b helper: apply per-voter favorability impacts at chamber tally
 * time. Resolves NPP ideologies via Phase 10's `deriveIdeology` and applies
 * deltas via `applyLegislatorImpacts` (bulk-write).
 *
 * Players (Characters) get the average delta since they have no recorded
 * ideology field.
 */

import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import { deriveIdeology } from "@/lib/sovereignDefault/npc/getExecutiveLeaderProfile";
import { applyLegislatorImpacts } from "@/lib/sovereignDefault/political/legislatorPoliticalImpact";

export async function applyLegislatorImpactsForChamber(
  db: Db,
  votes: Record<string, "for" | "against">,
  choice: SovereignResolutionChoice
): Promise<{ npcsAffected: number; charactersAffected: number }> {
  const voterIds = Object.keys(votes);
  if (voterIds.length === 0) return { npcsAffected: 0, charactersAffected: 0 };

  // Resolve voter IDs against both `npps` and `characters` collections in
  // parallel. Each voter ID is a 24-char hex string from the votes map.
  const ids = voterIds.filter((s) => /^[0-9a-fA-F]{24}$/.test(s)).map((s) => new ObjectId(s));

  const [nppsList, charsList] = await Promise.all([
    db
      .collection<NPP>("npps")
      .find({ _id: { $in: ids } })
      .project<{ _id: ObjectId; policies: NPP["policies"] }>({ policies: 1 })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({ _id: { $in: ids } })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray(),
  ]);

  const nppMap = new Map<string, { _id: ObjectId; policies: NPP["policies"] }>(
    nppsList.map((n) => [n._id.toString(), n])
  );
  const characterIds = new Set<string>(charsList.map((c) => c._id.toString()));

  return applyLegislatorImpacts(db, {
    votes,
    choice,
    npps: nppMap,
    characterIds,
    ideologyResolver: (npp) => deriveIdeology(npp.policies),
  });
}
