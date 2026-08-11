// src/lib/turn/npp/electionEntry.ts
/**
 * NPP Election Entry
 *
 * Handles deterministic, priority-based election entry for NPPs.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Incumbent defense first: Seat-holding NPPs re-enter their defending
 *    primary before generic party-pool fill runs. They bypass that seat's
 *    cooldown and are not blocked by same-party challengers because the
 *    incumbent should still appear in the defense primary.
 *
 * 2. Slate can still create primaries: Accepted slate rows file after the
 *    incumbent-defense pass, so a chair-assigned NPP can still join the same
 *    same-party primary as the defending incumbent and create a live contest.
 *
 * 3. One generic NPP per party per primary: Outside of incumbent defense and
 *    explicit slate filings, fallback party-pool fill contributes at most one
 *    active same-party candidate to each primary.
 *
 * 4. Deterministic selection: Uses RACE_PRIORITY ordering and sorted NPP lists
 *    so the same NPP always wins a slot given the same state. No randomness.
 *
 * 5. Country isolation: NPPs can only enter elections in their own country
 *    (npp.countryId === election.countryId). US NPPs can't enter UK races.
 */

import { ObjectId } from "mongodb";
import type { Election, ElectionCandidate, NPP } from "@/lib/db/types";
import {
  RACE_PRIORITY,
  canPartyFieldInState,
  isNPPAvailable,
  shouldDefendPrimary,
} from "../nppEntryLogic";
import {
  isElectionTypeEntryBlocked,
  isNationwideDirectExecutiveElection,
} from "@/lib/elections/nationwideExecutive";
import { officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  canFieldExecutiveCandidate,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";
import type { NPPContext } from "./context";
import { fileAcceptedSlateRows } from "./slateResponses";
import {
  buildSlateOverrideMaps,
  reconcileSlateMoves,
  slateSuppressesIncumbentDefense,
  slateSuppressesAutoPick,
} from "./slateOverride";
import { isActiveElectionCandidateDuplicateKey } from "@/lib/elections/duplicateKey";
import { isNppAutonomyActive, nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { careerArchetypeModifiersContinuous } from "@/lib/nppAutonomy/v3/careerArchetype";
import { ChallengerBudget } from "@/lib/nppAutonomy/playerImpactBudget";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { logger } from "../../observability/logger";

// Optional global salt so headless sim runs can vary this RNG across runs
// while staying reproducible within a run (mirrors nppActionProcessing.ts).
const ELECTION_ENTRY_RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";
// v3 ambitious-challenger pass (Phase 2.5): base per-primary-per-cycle chance a
// second same-party NPP also enters an already-filled primary, scaled by the
// challenger's officeSeekingMult. Kept low — this rolls once per already-filled
// party slot across every open primary, every cycle.
const CHALLENGER_BASE_PROBABILITY = 0.15;
// Player-enabled countries (reachable only at v4) get a halved challenger rate
// on top of the ChallengerBudget caps. A contested primary is good drama the
// first time and a chore the fifth, and in a player country the human is the
// one absorbing it.
const PLAYER_COUNTRY_CHALLENGER_MULT = 0.5;

interface EnterPrimaryOptions {
  incumbentDefense?: boolean;
  /**
   * v3 Phase 2.5 only: deliberately add a SECOND same-party candidate to a
   * primary that already has exactly one active candidate, rather than
   * competing for an empty slot. Skips the "one candidate per party" and
   * filledThisTurn short-circuits that guard every other entry path — the
   * caller has already verified this is intentional.
   */
  allowChallenger?: boolean;
}

export async function processElectionEntry(ctx: NPPContext): Promise<number> {
  const { db, now, candidatesByElection } = ctx;

  // Exclude technocrat NPPs (e.g. autonomous central-bank chairs) from
  // election entry. Mirrors the isTechnocrat: { $ne: true } query filter
  // applied by the standalone action / fund-generation phases — technocrats
  // never run for office.
  const allNPPs = ctx.allNPPs.filter((n) => !n.isTechnocrat);

  // NPPs are normally barred from presidential races, and always from any race
  // type whose resolver isn't production-ready. SP3 lifts the presidential bar
  // ONLY in autonomy-active countries (autonomy enabled AND not player-enabled),
  // where there is no player to contest the presidency — the seating + VP path
  // already supports NPP presidents (presidentResolution.ts). Player-enabled
  // countries keep the block; the gate is strictly per-country.
  const presidentCountryIds = new Set<CountryId>(
    ctx.openPrimaries
      .filter((p) => p.electionType === "president")
      .map((p) => (p.countryId ?? "US") as CountryId)
  );
  const autonomyPresidentCountries = new Set<string>();
  for (const cid of presidentCountryIds) {
    if (await isNppAutonomyActive(db, cid)) autonomyPresidentCountries.add(cid);
  }

  const openPrimaries = ctx.openPrimaries.filter((p) => {
    if (isElectionTypeEntryBlocked(p.electionType)) return false;
    if (p.electionType === "president") {
      return autonomyPresidentCountries.has((p.countryId ?? "US") as CountryId);
    }
    return true;
  });

  // Slate precedence (#904/#906): let a chair's slate override a COMPLIANT
  // NPP's own race choice. Build the (party,race)/per-NPP maps once, then free
  // any compliant NPP the chair has moved to a different race BEFORE we clone
  // candidacy state below, so the freed slot is visible to the entry phases.
  const nppById = new Map(allNPPs.map((n) => [n._id.toString(), n]));
  const slateMaps = await buildSlateOverrideMaps(ctx, openPrimaries);
  await reconcileSlateMoves(ctx, slateMaps, nppById);

  // Regional-presence gate (see canPartyFieldInState): a party with no
  // statePartyOrg row (or hasPresence: false) in a region does not field NEW
  // candidates there. Regions with no org data at all are exempt, as is
  // incumbent defense (a sitting seat-holder always defends their own seat).
  const statesWithOrgData = new Set<string>();
  for (const row of ctx.statePartyOrgs?.values() ?? []) statesWithOrgData.add(row.stateId);
  const partyPresenceAllows = (party: string, stateId: string | undefined | null): boolean => {
    if (!stateId) return true; // national races carry no regional org
    return canPartyFieldInState(
      ctx.statePartyOrgs?.get(`${stateId}_${party}`),
      statesWithOrgData.has(stateId),
      party
    );
  };

  // Track assignments this turn to prevent double-entry.
  const assignedThisTurn = new Set<string>();
  const filledThisTurn = new Set<string>(); // electionId_partyId

  // Clone candidacies to track in-memory state.
  const nppCandidacies = new Set(ctx.nppCandidacies);
  let entered = 0;

  // Snap primaries (snap_commons, snap_shugiin) defend the SAME seat as their
  // regular counterpart - normalize the election type so a sitting "commons"
  // MP is recognized as incumbent for a snap_commons primary.
  const isIncumbentFor = (npp: NPP, primary: Election): boolean => {
    const offices = ctx.officialsByNPP.get(npp._id.toString());
    if (!offices) return false;
    const primaryCountry = (primary.countryId ?? "US") as CountryId;
    const isNationalRace = isNationwideDirectExecutiveElection(
      primary.electionType,
      primary.state,
      primaryCountry
    );
    const officeKey = officeKeyForElectionType(primary.electionType, primary.countryId);
    return offices.some((o) => {
      if (o.officeType !== officeKey) return false;
      if (isNationalRace) return true;
      if (o.state !== primary.state) return false;
      if (typeof primary.senateClass === "number" && o.senateClass !== primary.senateClass) {
        return false;
      }
      if (typeof primary.chamberClass === "number" && o.chamberClass !== primary.chamberClass) {
        return false;
      }
      return true;
    });
  };

  const enterPrimary = async (
    npp: NPP,
    primary: Election,
    options: EnterPrimaryOptions = {}
  ): Promise<boolean> => {
    const { incumbentDefense = false, allowChallenger = false } = options;
    const key = `${primary._id}_${npp.party}`;

    // One-party-state guards. Legislative gate blocks banned-party AND
    // independent NPPs from any office; executive gate further restricts
    // executive offices to the ruling party only. Looks up regimeStatus via
    // the partyByCompositeKey map already in context — independents have no
    // entry and resolve to a null party, which the legislative gate rejects.
    const primaryCountry = (primary.countryId ?? npp.countryId ?? "US") as CountryId;
    const primaryConfig = COUNTRY_CONFIGS[primaryCountry];
    if (primaryConfig?.governmentType === "onePartyState") {
      const nppParty = ctx.partyByCompositeKey.get(`${primaryCountry}:${npp.party}`);
      if (!canFieldLegislativeCandidate(primaryConfig, nppParty ?? null)) {
        return false; // banned-party OR independent NPP — cannot legally field
      }
      if (!canFieldExecutiveCandidate(primaryConfig, nppParty ?? null, primary.electionType)) {
        return false; // approved-party NPP trying to file for executive office
      }
    }

    // Generic fill stops once the party slot is spoken for this turn. Incumbent
    // defense and the v3 challenger pass both intentionally add to an
    // already-filled slot (defend / contest it) rather than compete for an
    // empty one, so both skip this short-circuit.
    if (filledThisTurn.has(key) && !incumbentDefense && !allowChallenger) return false;

    // Regional-presence gate — new candidacies only; incumbents may always
    // file their own defense primary regardless of current org rows.
    if (!incumbentDefense && !partyPresenceAllows(npp.party, primary.state)) return false;

    const candidates = candidatesByElection.get(primary._id.toString()) ?? [];

    if (incumbentDefense) {
      if (!shouldDefendPrimary(npp, primary, candidates)) {
        return false;
      }
    } else if (allowChallenger) {
      // Caller (Phase 2.5) already verified exactly one active same-party
      // candidate exists and this challenger is otherwise eligible — only the
      // cooldown still needs checking here.
      const cooldownExpiry = npp.electionCooldowns?.[primary._id.toString()];
      if (cooldownExpiry && new Date(cooldownExpiry) > now) return false;
    } else {
      const hasPartyCandidate = candidates.some(
        (c) => c.party === npp.party && c.status === "active"
      );
      if (hasPartyCandidate) {
        filledThisTurn.add(key);
        return false;
      }

      const cooldownExpiry = npp.electionCooldowns?.[primary._id.toString()];
      if (cooldownExpiry && new Date(cooldownExpiry) > now) return false;
    }

    const candidateDoc: Omit<ElectionCandidate, "_id"> = {
      electionId: primary._id,
      countryId: (primary.countryId ?? npp.countryId ?? "US") as ElectionCandidate["countryId"],
      characterId: npp._id,
      characterName: npp.name,
      party: npp.party,
      status: "active",
      support: DEFAULT_CANDIDATE_SUPPORT,
      enteredAt: now,
      isNPP: true,
      nppId: npp._id,
    };

    try {
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .insertOne(candidateDoc as ElectionCandidate);
    } catch (error) {
      // The partial unique index allows one active candidacy per character. If
      // this NPP already holds one elsewhere (e.g. a next-cycle upcoming race),
      // treat them as already-claimed and skip — never let one collision throw
      // out of the whole election-entry pass.
      if (isActiveElectionCandidateDuplicateKey(error)) {
        nppCandidacies.add(npp._id.toString());
        ctx.nppCandidacies.add(npp._id.toString());
        return false;
      }
      throw error;
    }

    // Mutate in-memory turn state only after the insert actually lands.
    filledThisTurn.add(key);
    assignedThisTurn.add(npp._id.toString());
    nppCandidacies.add(npp._id.toString());
    ctx.nppCandidacies.add(npp._id.toString());

    if (!candidatesByElection.has(primary._id.toString())) {
      candidatesByElection.set(primary._id.toString(), []);
    }
    candidatesByElection.get(primary._id.toString())!.push({
      ...candidateDoc,
      _id: new ObjectId(),
    } as ElectionCandidate);

    console.log(
      `[Turn] NPP entry: ${npp.name} (${npp.party}) entered ${primary.electionType}/${primary.state}`
    );
    return true;
  };

  const isPartyEligibleForNppEntry = (npp: NPP, primary: Election): boolean => {
    if (!ctx.nppElectionEligiblePartyKeys) return true;
    const countryId = primary.countryId ?? npp.countryId ?? "US";
    return ctx.nppElectionEligiblePartyKeys.has(`${countryId}:${npp.party}`);
  };

  // Phase 1: incumbents defend their current seat before generic party fill.
  const incumbentEntries: { npp: NPP; primary: Election }[] = [];

  for (const npp of allNPPs) {
    if (npp.retiredAt) continue;
    if (nppCandidacies.has(npp._id.toString())) continue;

    const offices = ctx.officialsByNPP.get(npp._id.toString());
    if (!offices || offices.length === 0) continue;

    for (const primary of openPrimaries) {
      if (!isIncumbentFor(npp, primary)) continue;

      const nppCountry = npp.countryId ?? "US";
      if (primary.countryId && nppCountry !== primary.countryId) continue;
      if (!isPartyEligibleForNppEntry(npp, primary)) continue;

      // #904: a compliant incumbent the chair withdrew from (or moved off) this
      // race's slate defers to the chair instead of auto-defending the seat.
      if (slateSuppressesIncumbentDefense(npp, primary, slateMaps)) continue;

      incumbentEntries.push({ npp, primary });
    }
  }

  incumbentEntries.sort((a, b) => {
    const aIdx = RACE_PRIORITY.indexOf(a.primary.electionType as (typeof RACE_PRIORITY)[number]);
    const bIdx = RACE_PRIORITY.indexOf(b.primary.electionType as (typeof RACE_PRIORITY)[number]);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  for (const { npp, primary } of incumbentEntries) {
    if (assignedThisTurn.has(npp._id.toString())) continue;
    if (await enterPrimary(npp, primary, { incumbentDefense: true })) {
      entered++;
    }
  }

  // Phase 1a: file accepted slate rows after incumbents so chair-managed
  // challengers can still create a same-party primary against the defender.
  // Isolated so a filing fault can never abort the remaining entry phases.
  try {
    const slateFiling = await fileAcceptedSlateRows(ctx);
    entered += slateFiling.filed;
  } catch (error) {
    logger.error("Turn", "fileAcceptedSlateRows failed; continuing election entry", error);
  }

  // Reserve nationwide executive candidates before the regional generic-fill
  // pass consumes the available NPP pool. Presidential primaries are present
  // here only for autonomy-active countries; Uachtaran is directly elected in
  // non-playable Ireland. Incumbents already re-filed in Phase 1. Filing now
  // prevents a national office from being starved by lower-priority regional
  // races with the same primary deadline.
  const nationwideExecutivePrimaries = openPrimaries.filter((primary) => {
    const cid = (primary.countryId ?? "US") as CountryId;
    return isNationwideDirectExecutiveElection(primary.electionType, primary.state, cid);
  });
  for (const primary of nationwideExecutivePrimaries) {
    const cid = (primary.countryId ?? "US") as CountryId;
    const partiesForCountry = [
      ...new Set(allNPPs.filter((n) => (n.countryId ?? "US") === cid).map((n) => n.party)),
    ];
    for (const party of partiesForCountry) {
      const key = `${primary._id}_${party}`;
      if (filledThisTurn.has(key)) continue;

      const candidates = candidatesByElection.get(primary._id.toString()) ?? [];
      if (candidates.some((c) => c.party === party && c.status === "active")) {
        filledThisTurn.add(key);
        continue;
      }

      const pool = allNPPs
        .filter(
          (n) =>
            (n.countryId ?? "US") === cid &&
            n.party === party &&
            !assignedThisTurn.has(n._id.toString()) &&
            isNPPAvailable(n, nppCandidacies, now) &&
            (!ctx.nppElectionEligiblePartyKeys ||
              ctx.nppElectionEligiblePartyKeys.has(`${cid}:${n.party}`))
        )
        // Deterministic pick: lowest nppId string (sequentialId is not loaded
        // into the turn context).
        .sort((a, b) => (a._id.toString() < b._id.toString() ? -1 : 1));

      const npp = pool[0];
      if (!npp) continue;
      if (await enterPrimary(npp, primary)) entered++;
    }
  }

  // Phase 2: fill remaining slots with non-incumbent NPPs.
  const primariesByState = new Map<string, typeof openPrimaries>();
  for (const e of openPrimaries) {
    const state = e.state || e.countryId || "UNKNOWN";
    if (!primariesByState.has(state)) {
      primariesByState.set(state, []);
    }
    primariesByState.get(state)!.push(e);
  }

  // Index every NPP by `${country}:${party}:${state}` ONCE (O(N)). Both the
  // Phase 2 generic-fill and the Phase 2.5 challenger pass want NPPs matching a
  // specific (country, party, homeState) — previously each re-scanned the full
  // ~N-element allNPPs array inside nested loops (O(parties×states×N) and
  // O(primaries×parties×N) respectively), which is quadratic-ish and a real
  // cost at the 30-50-country target. The index makes those lookups O(1) + a
  // small residual filter. Insertion order is preserved (we iterate allNPPs
  // once), so the deterministic "first eligible NPP" pick downstream is
  // byte-identical.
  const nppsByCountryPartyState = new Map<string, NPP[]>();
  for (const npp of allNPPs) {
    const k = `${npp.countryId ?? "US"}:${npp.party}:${npp.homeState ?? ""}`;
    const list = nppsByCountryPartyState.get(k);
    if (list) list.push(npp);
    else nppsByCountryPartyState.set(k, [npp]);
  }

  const parties = [...new Set(allNPPs.map((n) => n.party))];

  for (const party of parties) {
    for (const [state, primaries] of primariesByState) {
      const primaryCountryId = primaries[0]?.countryId;

      // Candidate pool pre-filtered by (country, party, state) via the index.
      // When primaryCountryId is absent (effectively never — every election
      // carries a countryId), fall back to scanning all parties'/countries'
      // NPPs at this (party, state) to preserve the old "any country" match.
      const poolBase = primaryCountryId
        ? (nppsByCountryPartyState.get(`${primaryCountryId}:${party}:${state}`) ?? [])
        : allNPPs.filter((n) => n.party === party && (n.homeState ?? "") === state);

      const availableNPPs = poolBase.filter((npp) => {
        const nppCountry = npp.countryId ?? "US";

        // Incumbents must only enter via Phase 1 (defend their seat). If their
        // next-cycle primary hasn't been created yet this turn, excluding them
        // here prevents them landing in the wrong (higher-priority) race.
        const isIncumbent = ctx.officialsByNPP.has(npp._id.toString());

        return (
          !isIncumbent &&
          // #906: a compliant NPP with a chair slate assignment only enters where
          // the chair slated them (via Phase 1a) — never auto-picked back into
          // their own preferred (higher-priority) race.
          !slateSuppressesAutoPick(npp, slateMaps) &&
          (!ctx.nppElectionEligiblePartyKeys ||
            ctx.nppElectionEligiblePartyKeys.has(`${nppCountry}:${npp.party}`)) &&
          !assignedThisTurn.has(npp._id.toString()) &&
          isNPPAvailable(npp, nppCandidacies, now)
        );
      });

      const sortedPrimaries = [...primaries].sort((a, b) => {
        const aIdx = RACE_PRIORITY.indexOf(a.electionType as (typeof RACE_PRIORITY)[number]);
        const bIdx = RACE_PRIORITY.indexOf(b.electionType as (typeof RACE_PRIORITY)[number]);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });

      for (const primary of sortedPrimaries) {
        const key = `${primary._id}_${party}`;
        if (filledThisTurn.has(key)) continue;

        const candidates = candidatesByElection.get(primary._id.toString()) ?? [];
        const hasPartyCandidate = candidates.some(
          (c) => c.party === party && c.status === "active"
        );
        if (hasPartyCandidate) {
          filledThisTurn.add(key);
          continue;
        }

        // availableNPPs is already scoped to this (party, state) via the index,
        // so the first element is the eligible pick — no re-filter needed.
        const npp = availableNPPs[0];
        if (!npp) continue;

        if (await enterPrimary(npp, primary)) {
          entered++;
          const idx = availableNPPs.indexOf(npp);
          if (idx > -1) availableNPPs.splice(idx, 1);
        }
      }
    }
  }

  // Phase 2.5 (v3): ambitious challengers. Design decision #4 above ("same NPP
  // always wins A SLOT") governs which NPP fills an empty slot — it does not
  // mean every primary stays a single-candidate walkover forever. For
  // state/lower-chamber primaries that already have exactly one active
  // same-party candidate after Phase 1/2 above, a second same-party NPP may
  // also enter as a genuine primary challenger, gated by a seeded roll scaled
  // by the challenger's officeSeekingMult (v3 careerArchetype). This never
  // reduces coverage — Phase 1/2's guaranteed fill above is untouched and
  // already ran; this only ever ADDS a second candidate on top of an
  // already-filled slot. Capped at one extra challenger per party per primary
  // per cycle so primaries don't balloon into unbounded N-way races.
  // National (president) races are excluded — kept out of this pass for now.
  const challengerCountryIds = new Set<CountryId>(
    openPrimaries
      .filter((p) => p.electionType !== "president")
      .map((p) => (p.countryId ?? "US") as CountryId)
  );
  const v3ChallengerCountries = new Set<string>();
  for (const cid of challengerCountryIds) {
    if (await nppAutonomyAtLeast(db, cid, "v3")) v3ChallengerCountries.add(cid);
  }

  if (v3ChallengerCountries.size > 0) {
    const challengerRng = makeSeededRng(
      `npp-primary-challenger:${ctx.currentTurn}${ELECTION_ENTRY_RNG_SALT}`
    );
    // Aggregate restraint across the whole pass: caps challengers per country
    // and guarantees a given player candidate is challenged at most once per
    // election. The per-primary "one extra challenger" rule below bounds a
    // single race; this bounds what one player sees across all of them.
    const challengerBudget = new ChallengerBudget();
    const playerCountryFlags = new Map<string, boolean>();
    for (const cid of v3ChallengerCountries) {
      playerCountryFlags.set(cid, await isCountryEnabledForPlayers(db, cid as CountryId));
    }

    for (const primary of openPrimaries) {
      if (primary.electionType === "president") continue;
      const primaryCountryId = (primary.countryId ?? "US") as CountryId;
      if (!v3ChallengerCountries.has(primaryCountryId)) continue;

      const candidates = candidatesByElection.get(primary._id.toString()) ?? [];
      const activeByParty = new Map<string, ElectionCandidate[]>();
      for (const c of candidates) {
        if (c.status !== "active") continue;
        const list = activeByParty.get(c.party) ?? [];
        list.push(c);
        activeByParty.set(c.party, list);
      }

      for (const [party, partyCandidates] of activeByParty) {
        if (partyCandidates.length !== 1) continue; // already contested, or not applicable
        const sittingCandidate = partyCandidates[0];
        const existingNppId = sittingCandidate.nppId?.toString();

        // A candidate with no `nppId` is a human player. Before v4 this could
        // never happen (the pass is scoped to non-player countries), and the
        // exclusion filter below silently relied on that: `npp._id.toString()
        // === undefined` is false for every NPP, so nothing would be excluded
        // and the pool would happily produce a challenger against the player.
        // Player candidates are now explicit — challengeable, but only once per
        // election and only against the country budget.
        const isPlayerCandidate = !existingNppId;
        const playerCandidateKey = isPlayerCandidate
          ? `${primary._id.toString()}:${party}`
          : undefined;
        if (!challengerBudget.canChallenge(primaryCountryId, playerCandidateKey)) continue;

        // Index lookup (country/party/state guaranteed by the key) + residual
        // filters — replaces a full allNPPs scan per (primary, party).
        const challengerBase =
          nppsByCountryPartyState.get(`${primaryCountryId}:${party}:${primary.state ?? ""}`) ?? [];
        const challengerPool = challengerBase.filter((npp) => {
          if (npp._id.toString() === existingNppId) return false;
          if (assignedThisTurn.has(npp._id.toString())) return false;
          if (!isPartyEligibleForNppEntry(npp, primary)) return false;
          // #906: don't pull a chair-slated compliant NPP into a race they
          // weren't slated to as an ambitious challenger.
          if (slateSuppressesAutoPick(npp, slateMaps)) return false;
          return isNPPAvailable(npp, nppCandidacies, now);
        });
        if (challengerPool.length === 0) continue;

        // WHO challenges is now sampled, not frozen. Design decision #4
        // (deterministic pick) governs the guaranteed-fill passes above, where
        // stable coverage is the point; here it only meant "the same NPP is
        // forever the ambitious one", which is the opposite of the unpredictable
        // behaviour this pass exists to create. The pool is still sorted first
        // so the sample is order-stable, and the draw is from the same seeded
        // stream — replay-safe either way. Weighted by officeSeeking, so the
        // ambitious NPP is more likely rather than certain.
        challengerPool.sort((a, b) => (a._id.toString() < b._id.toString() ? -1 : 1));
        const weighted = challengerPool.map((npp) => ({
          npp,
          weight: Math.max(
            1,
            Math.round(careerArchetypeModifiersContinuous(npp.personality).officeSeekingMult * 100)
          ),
        }));
        const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
        let roll = challengerRng() * totalWeight;
        let challenger = weighted[weighted.length - 1].npp;
        for (const entry of weighted) {
          roll -= entry.weight;
          if (roll <= 0) {
            challenger = entry.npp;
            break;
          }
        }

        const { officeSeekingMult } = careerArchetypeModifiersContinuous(challenger.personality);
        const countryMult = playerCountryFlags.get(primaryCountryId)
          ? PLAYER_COUNTRY_CHALLENGER_MULT
          : 1;
        if (challengerRng() >= CHALLENGER_BASE_PROBABILITY * officeSeekingMult * countryMult) {
          continue;
        }

        if (await enterPrimary(challenger, primary, { allowChallenger: true })) {
          entered++;
          challengerBudget.record(primaryCountryId, playerCandidateKey);
        }
      }
    }
  }

  return entered;
}
