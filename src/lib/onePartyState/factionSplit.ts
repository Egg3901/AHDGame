/**
 * Faction split — auto-fires when the regime escalates to Stage 3
 * (internal challenge).
 *
 * Mechanics:
 *   1. Read the country's ruling-party officials.
 *   2. Score each on distance from the party line, blended toward their
 *      caucus's mean so a faction leaves as a faction (see
 *      `./factionDivergence`).
 *   3. Pick max(3, ceil(15% of officials)) defectors by highest
 *      divergence. Stable order via character id when divergences tie.
 *   4. Spawn a new approved party with the per-country
 *      `factionDefectionName`, positioned at the defectors' own centre of
 *      gravity rather than at the position of the party they just left.
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
import type { Character, ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { vacateDepartedLeadership } from "@/lib/parties/vacateDepartedLeadership";
import { recomputePartyMemberCount } from "@/lib/parties/recomputePartyMemberCount";
import { withdrawFromPartyLeadershipElections } from "@/lib/elections/withdrawFromPartyLeadershipElections";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { CaucusMembership } from "@/lib/db/types/caucus";
import {
  applyCaucusCohesion,
  factionCentreOfGravity,
  scoreDivergence,
  type PartyLine,
} from "./factionDivergence";

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
export { pickDefectors } from "./rules/factionDefection";
import { pickDefectors } from "./rules/factionDefection";

export interface FactionSplitResult {
  newPartySequentialId: number;
  defectorCount: number;
  defectorCharacterIds: ObjectId[];
  defectorNppIds: ObjectId[];
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
  // Reserved: divergence is scored from standing positions and caucus
  // membership, neither of which is turn-indexed, so the turn is still unused.
  // Kept in the signature for the callers that already thread it.
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

  // Actor namespaces stay separate: a null characterId must never enter a
  // character filter, and the sitting leader cannot defect from their party.
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  const actorKey = (o: Pick<ElectedOfficial, "characterId" | "nppId">) =>
    o.characterId ? `character:${o.characterId}` : o.nppId ? `npp:${o.nppId}` : null;
  const excluded = new Set([
    rulingParty.chairId ? `character:${rulingParty.chairId}` : null,
    gov?.pmCharacterId ? `character:${gov.pmCharacterId}` : null,
    gov?.pmNppId ? `npp:${gov.pmNppId}` : null,
  ]);
  const seen = new Set<string>();
  const eligible = officials.filter((o) => {
    const key = actorKey(o);
    if (!key || excluded.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (eligible.length === 0) return null;

  // Score who actually leaves. Position on the same (economic, social) axes the
  // election engine uses for policy distance, then blended toward the caucus
  // mean so a faction walks out as a faction rather than as an arbitrary 15% of
  // the bench. See `./factionDivergence` for why both halves matter.
  const characterIds = eligible.flatMap((o) => (o.characterId ? [o.characterId] : []));
  const nppIds = eligible.flatMap((o) => (!o.characterId && o.nppId ? [o.nppId] : []));
  const [defectorChars, defectorNpps, memberships] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ _id: { $in: characterIds } }, { projection: { _id: 1, policies: 1 } })
      .toArray(),
    db
      .collection<NPP>("npps")
      .find(
        { _id: { $in: nppIds } },
        { projection: { _id: 1, "policies.economic": 1, "policies.social": 1 } }
      )
      .toArray(),
    db
      .collection<CaucusMembership>("caucusMemberships")
      .find(
        {
          countryId,
          status: "active",
          $or: [
            { memberType: "character", memberId: { $in: characterIds } },
            { memberType: "npp", memberId: { $in: nppIds } },
          ],
        },
        { projection: { memberId: 1, memberType: 1, caucusId: 1 } }
      )
      .toArray(),
  ]);
  const positions = new Map<string, { economic?: number; social?: number } | null>([
    ...defectorChars.map((c) => [`character:${c._id}`, c.policies ?? null] as const),
    ...defectorNpps.map((c) => [`npp:${c._id}`, c.policies ?? null] as const),
  ]);
  const caucuses = new Map<string, string>();
  for (const m of memberships) {
    const key = `${m.memberType}:${m.memberId}`;
    if (!caucuses.has(key)) caucuses.set(key, m.caucusId.toString());
  }

  const line: PartyLine = {
    economic: rulingParty.economicPosition,
    social: rulingParty.socialPosition,
  };
  const scored = applyCaucusCohesion(
    eligible.map((o) => {
      const key = actorKey(o)!;
      const pos = positions.get(key);
      return {
        characterId: key,
        divergence: scoreDivergence(
          { characterId: key, economic: pos?.economic, social: pos?.social },
          line
        ),
        caucusId: caucuses.get(key) ?? null,
      };
    })
  );
  const byId = new Map(eligible.map((o) => [actorKey(o)!, o]));
  const defectors = pickDefectors(scored).map((score) => byId.get(score.characterId)!);
  if (defectors.length === 0) return null;

  // The new party sits where its defectors actually sit, not where the party
  // they walked out of sits. Inheriting the ruling party's axes verbatim made
  // every faction an ideological copy of its parent.
  const centre = factionCentreOfGravity(
    defectors.map((d) => {
      const pos = positions.get(actorKey(d)!);
      return { economic: pos?.economic, social: pos?.social };
    }),
    line
  );

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
    economicPosition: centre.economic,
    socialPosition: centre.social,
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
    createdTurn: _currentTurn,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<PoliticalParty>("politicalParties").insertOne(newParty);

  // Re-assign each defector character's party affiliation.
  const defectorIds = defectors.flatMap((d) => (d.characterId ? [d.characterId] : []));
  const defectorNppIds = defectors.flatMap((d) => (!d.characterId && d.nppId ? [d.nppId] : []));
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

  await db
    .collection<NPP>("npps")
    .updateMany(
      { _id: { $in: defectorNppIds } },
      { $set: { party: String(newSeq), updatedAt: now } }
    );
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateMany({ countryId, nppId: { $in: defectorNppIds } }, { $set: { party: String(newSeq) } });

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
    defectorNppIds,
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
