/**
 * Fetches and enriches candidate data for vote calculations.
 */

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, ElectionCandidate, NPP, PoliticalParty } from "@/lib/db/types";
import { type CountryId, type CountryConfig } from "@/lib/constants/countries";
import { resolveRegimeMultiplier } from "@/lib/turn/onePartyConstraints";
import { isBlocListCountry } from "@/lib/constants/blocList";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import type { NPPEndorsement } from "@/lib/db/types/nppInfluence";
import type { EnrichedCandidate } from "./types";
import {
  buildActiveVisibleNppEndorsementFilter,
  NPP_ENDORSEMENT_DIRECT_FAVORABILITY_CAP,
  NPP_ENDORSEMENT_DIRECT_FAVORABILITY_PER_ENDORSEMENT,
} from "@/lib/nppEndorsements";
import { buildPartyChairMaps, resolvePartyChairPrimaryRole } from "@/lib/primaryScore";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";

function clampPercentStat(value: number, fallback: number): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, safeValue));
}

// ─── Fetch & enrich candidate stats ──────────────────────────────────────────

/**
 * Fetch candidates with position/favorability/influence data required by the
 * election engine. When `includePartyPositions` is set, party econ/social
 * positions are attached per-candidate.
 *
 * `countryId` scopes the party lookup. Party `sequentialId` is unique only
 * within a country — multiple countries share `sequentialId = 1` for their
 * first-seeded party, so a global lookup keyed solely by sequentialId returns
 * whichever country's party was inserted last. Always pass `countryId` for
 * country-specific contexts (US presidential, UK primary, etc). If `countryId`
 * is omitted, the caller has opted into the legacy global-collision behavior
 * (e.g. in-flight presidential elections pre-dating the 2026-04-22 fix).
 */
export async function fetchEnrichedCandidates(
  candidates: ElectionCandidate[],
  options?: { includePartyPositions?: boolean; countryId?: CountryId }
): Promise<EnrichedCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }

  const db = await getDb();

  const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);

  const parties = await db
    .collection<{
      _id: unknown;
      sequentialId: number;
      countryId?: string;
      abbreviation?: string;
      economicPosition: number;
      socialPosition: number;
      chairId?: ObjectId | null;
    }>("politicalParties")
    .find(options?.countryId ? { countryId: options.countryId } : {})
    .toArray();

  // Candidates store party as String(sequentialId). When scoping by countryId we
  // can safely key the map by sequentialId alone (all entries belong to the same
  // country). Without countryId the query returned every party — later entries
  // overwrite earlier ones, which is the legacy (buggy) behavior preserved for
  // in-flight elections; see doc comment above.
  const partyAbbrById = new Map(
    parties
      .filter((p) => typeof p.abbreviation === "string" && p.abbreviation.length > 0)
      .map((p) => [String(p.sequentialId), p.abbreviation as string])
  );

  const partyPositions = options?.includePartyPositions
    ? new Map(
        parties.map((p) => [
          String(p.sequentialId),
          { econ: p.economicPosition, social: p.socialPosition },
        ])
      )
    : new Map<string, { econ: number; social: number }>();

  // OPS regime weighting: fetch each candidate's party regimeStatus so the
  // engine can apply the per-regime multiplier in vote distribution. The
  // lookup short-circuits cheaply for non-OPS countries. Reads runtime
  // governmentType + opsVoteMultipliers from countryState so a
  // post-Stage-4 conversion stops applying the OPS-specific weighting
  // immediately and reform-action vote-multiplier changes flow through.
  const electionCountry = options?.countryId;
  let electionConfig: Pick<CountryConfig, "governmentType" | "opsVoteMultipliers"> | null = null;
  if (electionCountry) {
    const runtime = await getCountryState(db, electionCountry);
    // Phase-5 reform: "Hold an honest by-election" sets a one-shot
    // pendingHonestByElection flag. When present, override every regime
    // multiplier with the uniform `atMultiplier` (1.0 by default — fully
    // equal weight) for this election only, then clear the flag.
    const honestOverride = runtime.pendingHonestByElection;
    let effectiveMultipliers = runtime.opsVoteMultipliers ?? undefined;
    // Bloc-list chambers weight nothing. The quota already fixes the party
    // split (see `@/lib/constants/blocList`), so a ruling-party multiplier can
    // no longer change who is seated; all it would still do is skew the
    // DISPLAYED vote by 8x. Since the only thing the vote decides here is the
    // order inside a party's own block, and the multiplier is uniform within a
    // party and therefore cancels there, the honest reading is 1.0 across the
    // board: the pie becomes real popularity, and the quota does the regime's
    // work in the open.
    if (runtime.governmentType === "onePartyState" && isBlocListCountry(electionCountry)) {
      effectiveMultipliers = { ruling: 1, approved: 1, independent: 1, banned: 0 };
    }
    if (honestOverride) {
      const m = honestOverride.atMultiplier;
      effectiveMultipliers = { ruling: m, approved: m, independent: m, banned: m };
      await updateCountryState(db, electionCountry, { pendingHonestByElection: undefined });
    }
    electionConfig = {
      governmentType: runtime.governmentType,
      opsVoteMultipliers: effectiveMultipliers,
    };
  }
  const isOps = electionConfig?.governmentType === "onePartyState";

  const partyRegimes = new Map<string, "ruling" | "approved" | "banned" | null>();
  if (isOps && electionCountry) {
    const partySeqIds = [
      ...new Set(
        candidates
          .map((c) => Number.parseInt(c.party ?? "0", 10))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    if (partySeqIds.length > 0) {
      const partyDocs = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: electionCountry, sequentialId: { $in: partySeqIds } })
        .toArray();
      for (const p of partyDocs) {
        partyRegimes.set(String(p.sequentialId), p.regimeStatus ?? null);
      }
    }
  }

  const [characters, npps, statePartyChairRows] = await Promise.all([
    characterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } })
          .toArray()
      : Promise.resolve([] as Character[]),
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray()
      : Promise.resolve([] as NPP[]),
    characterIds.length > 0
      ? db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ chairId: { $in: characterIds } }, { projection: { chairId: 1, stateId: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<StatePartyOrg, "chairId" | "stateId">[]),
  ]);

  const partyChairMaps = buildPartyChairMaps(parties, statePartyChairRows);

  const electionIds = [
    ...new Set(candidates.map((candidate) => candidate.electionId.toString())),
  ].map((id) => new ObjectId(id));
  const candidateTargetIds = [
    ...new Set(candidates.map((candidate) => candidate.characterId.toString())),
  ].map((id) => new ObjectId(id));
  const endorsementCollection = db.collection("nppEndorsements") as {
    find?: (filter: Record<string, unknown>) => { toArray: () => Promise<NPPEndorsement[]> };
  };
  const endorsementCounts =
    electionIds.length > 0 &&
    candidateTargetIds.length > 0 &&
    typeof endorsementCollection.find === "function"
      ? await endorsementCollection
          .find(
            buildActiveVisibleNppEndorsementFilter({
              electionId: { $in: electionIds },
              candidateId: { $in: candidateTargetIds },
            })
          )
          .toArray()
      : [];

  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
  const endorsementCountByKey = new Map<string, number>();
  for (const endorsement of endorsementCounts) {
    const key = `${endorsement.electionId.toString()}:${endorsement.candidateId.toString()}`;
    endorsementCountByKey.set(key, (endorsementCountByKey.get(key) ?? 0) + 1);
  }

  return candidates.map((c) => {
    let charEP = 0,
      charSP = 0,
      favorability = 50,
      politicalInfluence = 10,
      nationalInfluence = 0,
      partyInfluence = 0,
      archetypeApprovals: Record<string, number> | undefined,
      candidateInfamy: number | undefined;

    if (c.isNPP && c.nppId) {
      const npp = nppMap.get(c.nppId.toString());
      if (npp) {
        charEP = npp.policies.economic;
        charSP = npp.policies.social;
        favorability = npp.favorability;
        politicalInfluence = npp.politicalInfluence;
        nationalInfluence = npp.politicalInfluence; // NPPs use politicalInfluence as proxy for national
        archetypeApprovals = npp.archetypeApprovals;
        // NPPs have no partyInfluence — leave 0
      }
    } else {
      const char = charMap.get(c.characterId.toString());
      if (char) {
        charEP = char.policies.economic;
        charSP = char.policies.social;
        favorability = char.favorability;
        politicalInfluence = char.politicalInfluence;
        nationalInfluence = char.nationalInfluence ?? 0;
        partyInfluence = char.partyInfluence ?? 0;
        archetypeApprovals = char.archetypeApprovals;
        candidateInfamy = char.infamy;
      }
    }

    const clampedFavorability = clampPercentStat(favorability, 50);
    const endorsementBoost = Math.min(
      NPP_ENDORSEMENT_DIRECT_FAVORABILITY_CAP,
      (endorsementCountByKey.get(`${c.electionId.toString()}:${c.characterId.toString()}`) ?? 0) *
        NPP_ENDORSEMENT_DIRECT_FAVORABILITY_PER_ENDORSEMENT
    );
    const clampedPoliticalInfluence = clampPercentStat(politicalInfluence, 10);
    const hasResolvedNpp = Boolean(c.isNPP && c.nppId && nppMap.has(c.nppId.toString()));
    const resolvedNationalInfluence = hasResolvedNpp
      ? clampedPoliticalInfluence
      : Math.max(0, nationalInfluence);
    const partyPos = partyPositions.get(c.party);

    // OPS regime weighting: pluck the regime status (if any) and resolve a
    // per-candidate multiplier. Non-OPS resolves to 1.0; independents (no
    // party doc) resolve to the configured `independent` multiplier (0 by
    // default — same as banned).
    const regimeStatus = isOps ? (partyRegimes.get(c.party) ?? null) : undefined;
    const regimeMult = electionConfig
      ? resolveRegimeMultiplier(
          electionConfig,
          regimeStatus !== undefined ? { regimeStatus } : null
        )
      : 1.0;

    const charIdStr = c.characterId.toString();
    const partyChairRole = c.isNPP ? null : resolvePartyChairPrimaryRole(charIdStr, partyChairMaps);
    const stateChairStateIds =
      partyChairRole === "state"
        ? (partyChairMaps.stateChairStatesByCharacterId.get(charIdStr) ?? [])
        : undefined;

    return {
      candidateId: c._id.toString(),
      characterId: charIdStr,
      characterName: c.characterName,
      party: c.party,
      ...(partyAbbrById.get(c.party) ? { partyAbbr: partyAbbrById.get(c.party) } : {}),
      isNPP: c.isNPP ?? false,
      charEP,
      charSP,
      favorability: clampPercentStat(clampedFavorability + endorsementBoost, 50),
      politicalInfluence: clampedPoliticalInfluence,
      nationalInfluence: resolvedNationalInfluence,
      partyInfluence: Math.max(0, partyInfluence),
      partyChairRole,
      ...(stateChairStateIds ? { stateChairStateIds } : {}),
      infamy: candidateInfamy,
      archetypeApprovals,
      regimeMult,
      // Pass through `electionCandidates.support` so general-election
      // vote distribution can consume it via supportMoodMultiplier. Missing
      // values degrade to neutral 1.0x in the formula.
      ...(typeof c.support === "number" ? { support: c.support } : {}),
      ...(partyPos && { partyEcon: partyPos.econ, partySocial: partyPos.social }),
      ...(regimeStatus !== undefined ? { regimeStatus } : {}),
    };
  });
}
