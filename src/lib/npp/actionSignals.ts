/**
 * NPP ACTION CONTEXT SIGNALS (V3/V4)
 *
 * The action AI historically decided what an NPP should do from three inputs:
 * whether they hold office, their personality, and what they can afford. That
 * makes for a politician who campaigns identically the week before an election
 * and three years out, who keeps buying advertising at 100 favorability where the
 * gain is capped away to nothing, and who donates to a party treasury regardless
 * of whether it is flush or empty.
 *
 * This module gathers the missing world-state — election proximity, whether the
 * NPP is actually running and actually contested, whether their party is in
 * government, and how healthy that party's treasury is — into a lookup the
 * action AI can consult per NPP with no further I/O.
 *
 * **The load discipline is the point.** `processNppActions` iterates every
 * non-retired NPP with action points, which is tens of thousands of documents in
 * a mature world. Every field here is fetched in a fixed number of queries
 * *before* that cursor opens and resolved from in-memory maps inside it. Nothing
 * in this file may ever grow a per-NPP round trip; that would turn a single turn
 * phase into an O(NPPs) query storm.
 */

import type { Db, ObjectId } from "mongodb";
import type { Election, ElectionCandidate, PoliticalParty } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import type { CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

/** World-state inputs to the v3+ action brain. All optional-safe. */
export interface NppContextSignals {
  /** Turns until the soonest open race this NPP could plausibly contest; null if none known. */
  turnsToElection: number | null;
  /** Is this NPP currently an active candidate somewhere? */
  isCandidate: boolean;
  /** Is that candidacy contested by a same-party rival? */
  facesChallenger: boolean;
  /** Is this NPP's party in government (governing party or coalition member)? */
  inGovernment: boolean;
  /**
   * This party's treasury as a ratio of the median party treasury in the same
   * country: 1 = typical, <1 = poorer than its rivals, >1 = flush. Null when the
   * country has no comparable parties.
   *
   * Deliberately a *ratio* rather than an absolute figure. Party treasuries are
   * in local home currency, so any flat threshold would mean something different
   * in every country and would need FX conversion to be comparable. Ranking a
   * party against its actual rivals is both currency-free and a better model of
   * the decision anyway — a politician judges whether their party is short of
   * money relative to the opposition, not against an absolute number.
   */
  partyTreasuryRatio: number | null;
}

export const NEUTRAL_SIGNALS: NppContextSignals = {
  turnsToElection: null,
  isCandidate: false,
  facesChallenger: false,
  inGovernment: false,
  partyTreasuryRatio: null,
};

/** Resolves signals for individual NPPs from pre-loaded maps. */
export interface NppSignalLookup {
  signalsFor(npp: Pick<NPP, "countryId" | "party" | "homeState" | "_id">): NppContextSignals;
}

function electionKey(countryId: string, state: string | undefined): string {
  return `${countryId}:${state ?? ""}`;
}

function partyKey(countryId: string, party: string): string {
  return `${countryId}:${party}`;
}

/**
 * Build the signal lookup for one action-processing cycle.
 *
 * Exactly three queries, plus the parties map the caller already has to load for
 * the treasury flush (passed in rather than re-fetched, so this adds nothing for
 * that field). `countryScope` mirrors the autonomy scope: null means global (v4).
 */
export async function buildNppSignalLookup(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null,
  partiesByKey: Map<string, Pick<PoliticalParty, "_id" | "treasury">>
): Promise<NppSignalLookup> {
  const countryFilter = countryScope ? { countryId: { $in: countryScope } } : {};

  const [elections, candidates, formations] = await Promise.all([
    db
      .collection<Election>("elections")
      .find(
        { status: { $in: ["upcoming", "active"] }, ...countryFilter },
        { projection: { countryId: 1, state: 1, startTurn: 1 } }
      )
      .toArray(),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find(
        { status: "active", nppId: { $exists: true } },
        { projection: { nppId: 1, electionId: 1, party: 1 } }
      )
      .toArray(),
    getGovernmentFormationsCollection(db)
      .find(countryFilter, {
        projection: { countryId: 1, governingPartyId: 1, coalitionPartyIds: 1 },
      })
      .toArray(),
  ]);

  // Soonest upcoming race per (country, state), plus a per-country fallback so
  // an NPP whose own state has no open race still feels a national cycle.
  const turnsByStateKey = new Map<string, number>();
  const turnsByCountry = new Map<string, number>();
  for (const election of elections) {
    if (election.startTurn == null) continue;
    const remaining = election.startTurn - currentTurn;
    if (remaining < 0) continue;
    const sKey = electionKey(election.countryId, election.state);
    const prevState = turnsByStateKey.get(sKey);
    if (prevState == null || remaining < prevState) turnsByStateKey.set(sKey, remaining);
    const prevCountry = turnsByCountry.get(election.countryId);
    if (prevCountry == null || remaining < prevCountry) {
      turnsByCountry.set(election.countryId, remaining);
    }
  }

  // Candidacy + contest state. `sameParty` counts per (election, party) so a
  // second same-party candidate reads as a primary challenge.
  const candidateElectionByNpp = new Map<string, string>();
  const candidatePartyByNpp = new Map<string, string>();
  const samePartyCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.nppId) continue;
    const nppId = (candidate.nppId as ObjectId).toString();
    const electionId = candidate.electionId.toString();
    candidateElectionByNpp.set(nppId, electionId);
    candidatePartyByNpp.set(nppId, candidate.party);
    const key = `${electionId}:${candidate.party}`;
    samePartyCounts.set(key, (samePartyCounts.get(key) ?? 0) + 1);
  }

  // Median party treasury per country, for the currency-free wealth ratio.
  const treasuriesByCountry = new Map<string, number[]>();
  for (const [key, party] of partiesByKey) {
    const countryId = key.split(":")[0];
    const treasury = Number.isFinite(party.treasury) ? (party.treasury as number) : 0;
    const list = treasuriesByCountry.get(countryId) ?? [];
    list.push(treasury);
    treasuriesByCountry.set(countryId, list);
  }
  const medianTreasuryByCountry = new Map<string, number>();
  for (const [countryId, list] of treasuriesByCountry) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    if (median > 0) medianTreasuryByCountry.set(countryId, median);
  }

  const governingByCountry = new Map<string, Set<string>>();
  for (const formation of formations) {
    const parties = new Set<string>();
    if (formation.governingPartyId) parties.add(formation.governingPartyId);
    for (const id of formation.coalitionPartyIds ?? []) parties.add(id);
    governingByCountry.set(formation.countryId, parties);
  }

  return {
    signalsFor(npp) {
      const countryId = npp.countryId ?? "US";
      const nppId = npp._id.toString();

      const turnsToElection =
        turnsByStateKey.get(electionKey(countryId, npp.homeState)) ??
        turnsByCountry.get(countryId) ??
        null;

      const electionId = candidateElectionByNpp.get(nppId);
      const isCandidate = electionId !== undefined;
      const party = candidatePartyByNpp.get(nppId) ?? npp.party;
      const facesChallenger =
        isCandidate && (samePartyCounts.get(`${electionId}:${party}`) ?? 0) > 1;

      const inGovernment = governingByCountry.get(countryId)?.has(npp.party) ?? false;

      const treasury = partiesByKey.get(partyKey(countryId, npp.party))?.treasury;
      const median = medianTreasuryByCountry.get(countryId);
      const partyTreasuryRatio =
        median != null && Number.isFinite(treasury) ? (treasury as number) / median : null;

      return { turnsToElection, isCandidate, facesChallenger, inGovernment, partyTreasuryRatio };
    },
  };
}
