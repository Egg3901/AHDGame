import type { Db, Filter } from "mongodb";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import {
  PER_NATION_TURN_CAP,
  polesForYear,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { getCountryAlignmentsCollection } from "@/lib/db/collections/countryAlignments";
import { normalizeShares } from "@/lib/alignment/normalize";
import type { WorldBloc } from "@/lib/world/bloc";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/**
 * How far a conquered nation swings toward the bloc that took it.
 *
 * Capped by `PER_NATION_TURN_CAP` at the write, so a war outcome is decisive but not
 * unbounded: losing the war moves a country as far as a full turn of the most
 * concentrated influence effort could, and no further.
 */
const OUTCOME_SWING = PER_NATION_TURN_CAP;

/** Pole ids, in both era vocabularies, that belong to each bloc. */
const POLES_BY_BLOC: Record<WorldBloc, AlignmentPoleId[]> = {
  west: ["WEST", "WASHINGTON"],
  east: ["EAST", "MOSCOW"],
  // A non-aligned victor pulls nobody anywhere: there is no pole to swing toward,
  // and the empty list makes that a no-op rather than a special case upstream.
  nonAligned: [],
};

/**
 * Swing the conquered hosts toward the bloc that won the war.
 *
 * ⚠️ Deliberately NOT routed through `commitInfluencePlay`. That is not a generic
 * delta applier: it debits the org fund, requires a sponsor and an amount, prices
 * against the target's GDP, refuses a `target-locked` nation, and only QUEUES a play
 * to be resolved against rival bids. A war outcome routed through it moves nothing —
 * silently — in several ordinary cases, including the common one where the winning
 * bloc has spent itself down fighting. There is no bid here and nobody to outbid.
 *
 * It also moves a LOCKED nation, which `computeDrift` refuses. That gate exists so
 * money cannot shift an already-committed country; a nation that was just conquered
 * is a different case, and refusing would make the most decisive outcome in the game
 * move nothing at all.
 *
 * ⚠️ The pole comes from the LIVE YEAR while the organisation came from the preset.
 * Poles are era state, re-keyed through `era.inherit` at 1991 — a preset-derived
 * `EAST` written into a post-1991 row is either dropped by `normalizeShares` or
 * clobbers the WASHINGTON/MOSCOW vocabulary the row is actually in. An alliance's
 * identity does not expire; the vocabulary its standing is expressed in does.
 */
export async function applyConflictOutcomeAlignment(
  db: Db,
  params: {
    entityIds: WorldEntityId[];
    bloc: WorldBloc;
    turn: number;
    /** The LIVE game year, not the preset's. */
    year: number;
  }
): Promise<{ moved: number }> {
  const { entityIds, bloc, turn, year } = params;
  const poles = polesForYear(year);
  const target = POLES_BY_BLOC[bloc].find((p) => poles.includes(p));
  // No pole for this bloc in this era's vocabulary: move nothing rather than write a
  // key the row does not speak.
  if (!target) return { moved: 0 };

  const col = await getCountryAlignmentsCollection(db);
  let moved = 0;

  for (const entityId of entityIds) {
    // The row is keyed by entity, and a proxy war's hosts are world entities that
    // are not playable countries — the alignment seed carries them all the same.
    const row = await col.findOne({ entityId } as Filter<CountryAlignment>);
    if (!row) continue;

    const raw: Partial<Record<AlignmentPoleId, number>> = { ...row.shares };
    raw[target] = (raw[target] ?? 0) + OUTCOME_SWING;

    // `normalizeShares` owns the whole invariant — every pole present, and shares
    // plus nonAligned summing to 100 — and returns BOTH halves. Adding to one pole
    // and letting it renormalise is what takes the swing out of the others; deriving
    // `nonAligned` here instead would be a second, divergent copy of that rule.
    const { shares, nonAligned } = normalizeShares(raw, poles);

    await col.updateOne(
      { _id: row._id },
      {
        $set: {
          shares,
          nonAligned,
          previous: { shares: row.shares, nonAligned: row.nonAligned },
          turn,
        },
      }
    );
    moved++;
  }

  return { moved };
}
