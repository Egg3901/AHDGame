/**
 * Faction split — auto-fires when the regime escalates to Stage 3
 * (internal challenge).
 *
 * Mechanics:
 *   1. Read the country's ruling-party officials.
 *   2. Compute a divergence score for each (placeholder: zero — the
 *      richer faction subsystem on `feature/legislation-update-cn` will
 *      supply per-character voting-record divergence later).
 *   3. Pick max(3, ceil(15% of officials)) defectors by highest
 *      divergence. Stable order via character id when divergences tie.
 *   4. Spawn a new approved party with the per-country
 *      `factionDefectionName`, seeded from the ruling-party's
 *      ideology fields (same axis positions).
 *   5. Re-assign each defector's `party` field to the new sequentialId.
 *
 * Per the spec: the defection list is published in the country-history
 * entry (the wider Stage 3 transition handles that — this module just
 * spawns the party + reassigns officials).
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import type { Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { vacateDepartedLeadership } from "@/lib/parties/vacateDepartedLeadership";
import { recomputePartyMemberCount } from "@/lib/parties/recomputePartyMemberCount";
import { withdrawFromPartyLeadershipElections } from "@/lib/elections/withdrawFromPartyLeadershipElections";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

export interface OfficialAlignment {
  characterId: ObjectId;
  /** Composite divergence score vs ruling-party priority profile. Higher = more divergent. */
  divergence: number;
}

/**
 * Pick the defectors from a list of ruling-party officials. Returns
 * max(3, ceil(15% of officials)) sorted by divergence descending, ties
 * broken by stable input order. If fewer than 3 officials exist,
 * returns all of them.
 */
export function pickDefectors(officials: OfficialAlignment[]): OfficialAlignment[] {
  if (officials.length === 0) return [];
  const target = Math.min(officials.length, Math.max(3, Math.ceil(officials.length * 0.15)));
  // Stable sort: tag with index, sort by divergence desc + index asc to break ties.
  const tagged = officials.map((o, idx) => ({ ...o, _idx: idx }));
  tagged.sort((a, b) => {
    if (b.divergence !== a.divergence) return b.divergence - a.divergence;
    return a._idx - b._idx;
  });
  return tagged.slice(0, target).map(({ _idx: _, ...rest }) => rest);
}

export interface FactionSplitResult {
  newPartySequentialId: number;
  defectorCount: number;
  defectorCharacterIds: ObjectId[];
}

/**
 * Fire the faction split. No-op (returns null) when:
 *   - the country's CountryConfig doesn't declare `factionDefectionName`
 *   - the country has no current ruling party (e.g. post-conversion)
 *   - the ruling party has no officials to defect
 */
export async function fireFactionSplit(
  db: Db,
  countryId: CountryId,
  // Reserved for the richer faction subsystem on
  // feature/legislation-update-cn, which will read per-turn voting-record
  // divergence to score defection candidates. Today's placeholder
  // implementation scores every official at 0, so the turn is unused.
  _currentTurn: number
): Promise<FactionSplitResult | null> {
  const cfg = COUNTRY_CONFIGS[countryId];
  if (!cfg) return null;
  const defectionName = cfg.factionDefectionName;
  if (!defectionName) return null;

  const runtime = await getCountryState(db, countryId);
  if (runtime.rulingPartyId === null) return null;

  // Find the ruling party (carries default ideology + isDefault flag we'll inherit)
  const rulingParty = await db.collection<PoliticalParty>("politicalParties").findOne({
    countryId,
    sequentialId: runtime.rulingPartyId,
  });
  if (!rulingParty) return null;

  // Find all officials affiliated with the ruling party by sequentialId-as-string
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId, party: String(rulingParty.sequentialId) })
    .toArray();
  if (officials.length === 0) return null;

  // Only character-held seats can defect. NPP-held seats carry
  // `characterId: null`; letting those nulls into the defector list made the
  // `$in` seat-update below match EVERY null-characterId row and flip all
  // NPP seats to the new party (#3164). The ruling party's chair and the
  // country's installed leader are also excluded — the placeholder scorer
  // ranks everyone equally, and "the leader defects from their own party"
  // is never the intended read of a faction split.
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  const excluded = new Set(
    [rulingParty.chairId, gov?.pmCharacterId]
      .filter((id): id is ObjectId => id != null)
      .map((id) => id.toString())
  );
  const seen = new Set<string>();
  const eligible = officials.filter((o) => {
    if (!o.characterId) return false;
    const key = o.characterId.toString();
    if (excluded.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (eligible.length === 0) return null;

  // Read character divergence scores. Placeholder: zero for every official
  // until the richer faction subsystem on feature/legislation-update-cn
  // lands a real voting-record divergence reader.
  const alignments: OfficialAlignment[] = eligible.map((o) => ({
    characterId: o.characterId as ObjectId,
    divergence: 0,
  }));
  const defectors = pickDefectors(alignments);
  if (defectors.length === 0) return null;

  // Spawn the defected party. Inherits ideology fields from the ruling
  // party (same axis positions) but starts at `approved` regime status
  // so it can participate in legislation under one-party-state rules.
  const newSeq = await getNextSequentialId(db, "party", countryId);
  const now = new Date();
  const abbreviation = deriveAbbreviation(defectionName);
  const newParty: PoliticalParty = {
    _id: new ObjectId(),
    sequentialId: newSeq,
    countryId,
    name: defectionName,
    abbreviation,
    color: "#9333ea", // distinct purple for the defected faction
    economicPosition: rulingParty.economicPosition,
    socialPosition: rulingParty.socialPosition,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    campaignerIds: [],
    committeeIds: [],
    memberCount: defectors.length,
    isDefault: false,
    createdBy: null,
    treasury: 0,
    nationalTaxRate: rulingParty.nationalTaxRate,
    politicalStrength: 0,
    regimeStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<PoliticalParty>("politicalParties").insertOne(newParty);

  // Re-assign each defector character's party affiliation.
  const defectorIds = defectors.map((d) => d.characterId);
  await db
    .collection<Character>("characters")
    .updateMany({ _id: { $in: defectorIds } }, { $set: { party: String(newSeq), updatedAt: now } });
  // Also update their ElectedOfficials rows so the legislature reflects
  // the new affiliation immediately.
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateMany(
      { countryId, characterId: { $in: defectorIds } },
      { $set: { party: String(newSeq) } }
    );

  // #0701 split-cleanup — a defector may have been the ruling party's chair,
  // vice chair, or treasurer. Vacate those slots so the ruling party no
  // longer lists leaders who defected. Excludes the new party (whose
  // leadership starts null anyway).
  await vacateDepartedLeadership(db, countryId, defectorIds, {
    exceptPartySequentialId: newSeq,
  });

  // The ruling party's memberCount was never decremented for the defectors, so
  // it now over-counts. Recompute it from live membership (authoritative).
  await recomputePartyMemberCount(db, countryId, rulingParty.sequentialId);

  // Defectors can no longer stand or vote in the ruling party's leadership
  // races — withdraw their candidacies and delete their (and votes-for-them)
  // ballots in that party's active elections.
  await withdrawFromPartyLeadershipElections(
    db,
    defectorIds,
    String(rulingParty.sequentialId),
    countryId
  );

  return {
    newPartySequentialId: newSeq,
    defectorCount: defectors.length,
    defectorCharacterIds: defectorIds,
  };
}

/**
 * Derive a 3-5 char abbreviation from a party name by taking the first
 * letter of each capitalised word. Defaults to "FAC" when the name has
 * no capitalised words.
 */
function deriveAbbreviation(name: string): string {
  const caps = name.match(/\b[A-Z][a-zA-Z]*/g) ?? [];
  const initials = caps
    .map((w) => w[0])
    .join("")
    .slice(0, 5);
  return initials.length >= 2 ? initials : "FAC";
}
