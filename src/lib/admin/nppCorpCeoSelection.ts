/**
 * Pure selection logic for choosing the CEO of a newly spawned NPP corporation.
 *
 * Prefers reusing an existing NPP that does not already run a corp, distributing
 * corp ownership evenly across participating affiliations (active non-defunct
 * parties + `"independent"`). Only when no eligible NPP exists anywhere does it
 * fall back to creating a brand-new `"independent"` NPP.
 *
 * This module performs no I/O — the caller gathers the per-affiliation counts and
 * free-NPP candidates from the database and passes them in, which keeps the
 * branching logic exhaustively unit-testable.
 *
 * NPP engine 6: when the caller passes the company's operating lane (v6 only),
 * a free NPP with a good CEO record in that lane is preferred over the party
 * balance. Without a lane, or when nobody has a good record, the rule above
 * applies unchanged.
 */

import type { OperatingSectorType } from "@/lib/constants/corporations";
import type { NppCeoTrackRecord } from "@/lib/db/types/npp";
import { ceoRecordScore, hasGoodCeoRecord } from "@/lib/nppAutonomy/v6/rules/ceoTrackRecord";

export const INDEPENDENT_PARTY = "independent";

export interface FreeNpp {
  /** NPP `_id` as a string. */
  id: string;
  /** `politicalInfluence` — higher is preferred within an affiliation. */
  influence: number;
  /** `sequentialId` — lower breaks influence ties. */
  seq: number;
  /** CEO track record, loaded only for v6 selection. */
  trackRecord?: NppCeoTrackRecord;
}

export interface NppCorpCeoAffiliation {
  /** Party sequentialId as a string, or `"independent"`. */
  party: string;
  /** NPP-corps this affiliation already controls. */
  corpCount: number;
  /** Active NPPs in this affiliation that are not already a CEO. */
  freeNpps: FreeNpp[];
}

export interface ChooseNppCorpCeoInput {
  /** Explicit party override (legacy `nppPartyId`). When set, balancing is bypassed. */
  forcedParty?: string;
  /**
   * Participating affiliations: active non-defunct parties plus `"independent"`.
   * Defunct parties must be excluded by the caller.
   */
  affiliations: NppCorpCeoAffiliation[];
  /**
   * NPP engine 6 (v6 only): the company's operating lane. When set, a free NPP
   * with a good record in this lane wins over the party balance.
   */
  sectorLane?: OperatingSectorType;
}

export type CeoChoice =
  { kind: "existing"; party: string; nppId: string } | { kind: "new"; party: string };

export interface BuildCeoAffiliationsInput {
  /** SequentialId strings of active, non-defunct parties in the country. */
  nonDefunctPartyIds: string[];
  /** One entry per existing NPP-corp: its CEO's NPP id and party. */
  existingCorpCeos: Array<{ nppId: string; party: string }>;
  /** Every active (non-retired) NPP in the country. */
  activeNpps: Array<{
    id: string;
    party: string;
    influence: number;
    seq: number;
    trackRecord?: NppCeoTrackRecord;
  }>;
}

/**
 * Shape raw DB rows into the per-affiliation view {@link chooseNppCorpCeo} needs.
 * Participating affiliations are the non-defunct parties plus `"independent"`;
 * NPPs already running a corp, and NPPs in non-participating (e.g. defunct)
 * affiliations, are excluded from the free pool.
 */
export function buildCeoAffiliations(input: BuildCeoAffiliationsInput): NppCorpCeoAffiliation[] {
  const { nonDefunctPartyIds, existingCorpCeos, activeNpps } = input;

  const participating = new Set<string>(nonDefunctPartyIds);
  participating.add(INDEPENDENT_PARTY);

  const corpCount = new Map<string, number>();
  const ceoIds = new Set<string>();
  for (const ceo of existingCorpCeos) {
    ceoIds.add(ceo.nppId);
    corpCount.set(ceo.party, (corpCount.get(ceo.party) ?? 0) + 1);
  }

  const freeByParty = new Map<string, FreeNpp[]>();
  for (const n of activeNpps) {
    if (ceoIds.has(n.id)) continue; // already runs a corp
    if (!participating.has(n.party)) continue; // defunct / non-participating
    const list = freeByParty.get(n.party) ?? [];
    list.push({
      id: n.id,
      influence: n.influence,
      seq: n.seq,
      ...(n.trackRecord ? { trackRecord: n.trackRecord } : {}),
    });
    freeByParty.set(n.party, list);
  }

  return [...participating].map((party) => ({
    party,
    corpCount: corpCount.get(party) ?? 0,
    freeNpps: freeByParty.get(party) ?? [],
  }));
}

/** Sort key so `"independent"` always orders after numbered parties on ties. */
function partyOrder(party: string): number {
  const n = Number(party);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Best NPP within an affiliation: highest influence, then lowest sequentialId. */
function pickBestNpp(freeNpps: FreeNpp[]): FreeNpp {
  return [...freeNpps].sort((a, b) => b.influence - a.influence || a.seq - b.seq)[0];
}

/**
 * NPP engine 6: the free NPP with the best good record in `lane` across
 * `pool`, or null when nobody has one. Ties go to the party running fewer
 * companies, then influence, then lower sequentialId.
 */
function pickByTrackRecord(
  pool: NppCorpCeoAffiliation[],
  lane: OperatingSectorType
): { party: string; nppId: string } | null {
  let best: { party: string; corpCount: number; npp: FreeNpp; score: number } | null = null;
  for (const a of pool) {
    for (const npp of a.freeNpps) {
      if (!hasGoodCeoRecord(npp.trackRecord, lane)) continue;
      const score = ceoRecordScore(npp.trackRecord, lane) ?? 0;
      const better =
        !best ||
        score > best.score ||
        (score === best.score &&
          (a.corpCount - best.corpCount ||
            partyOrder(a.party) - partyOrder(best.party) ||
            best.npp.influence - npp.influence ||
            npp.seq - best.npp.seq) < 0);
      if (better) best = { party: a.party, corpCount: a.corpCount, npp, score };
    }
  }
  return best ? { party: best.party, nppId: best.npp.id } : null;
}

export function chooseNppCorpCeo(input: ChooseNppCorpCeoInput): CeoChoice {
  const { forcedParty, affiliations, sectorLane } = input;

  if (sectorLane) {
    const pool =
      forcedParty != null && forcedParty !== ""
        ? affiliations.filter((a) => a.party === forcedParty)
        : affiliations;
    const byRecord = pickByTrackRecord(pool, sectorLane);
    if (byRecord) return { kind: "existing", ...byRecord };
  }

  if (forcedParty != null && forcedParty !== "") {
    const target = affiliations.find((a) => a.party === forcedParty);
    if (target && target.freeNpps.length > 0) {
      return { kind: "existing", party: forcedParty, nppId: pickBestNpp(target.freeNpps).id };
    }
    return { kind: "new", party: forcedParty };
  }

  const candidates = affiliations.filter((a) => a.freeNpps.length > 0);
  if (candidates.length === 0) {
    return { kind: "new", party: INDEPENDENT_PARTY };
  }

  // Fewest corps wins; ties broken by lower party id (independent last).
  const chosen = [...candidates].sort(
    (a, b) => a.corpCount - b.corpCount || partyOrder(a.party) - partyOrder(b.party)
  )[0];

  return { kind: "existing", party: chosen.party, nppId: pickBestNpp(chosen.freeNpps).id };
}
