/**
 * formNppCabinet — autonomous cabinet formation (V1.3).
 *
 * Once a non-player country has a seated NPP head of government (PM/president/
 * premier, from V1.1 / v0 seating), the dormant ministerial levers stay off
 * until a cabinet exists. This directly fills the country's vacant cabinet posts
 * from co-partisan NPPs — the parliamentary / one-party model, NOT the US-only
 * `cabinetNominationLifecycle` (Senate confirmation), which V1-target countries
 * do not use. Each seat is filled directly, mirroring how a Taoiseach/Premier
 * appoints their government.
 *
 * Selection is deterministic and bounded (the codebase's formula + clamp ethos):
 * candidates are scored by ideology-fit to the governing head (an
 * ideologically-coherent cabinet) plus a competence proxy (loyalty, ambition,
 * influence, favorability). The head's governing archetype tunes how much
 * ideology-fit matters — an `ideologue` stacks the cabinet with ideological
 * allies; a `technocrat` weights competence — by reusing the same
 * `ideologyWeightMult` knob the agenda blend uses.
 *
 * Gating: `nppAutonomyAtLeast(v1)` (also enforces the player rail: false below
 * v2 in player-enabled countries). Idempotent — only vacant posts are filled, so
 * it is safe to call every turn; a filled cabinet is a no-op.
 */

import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { NPPPersonality } from "@/lib/db/types/npp";
import type { CabinetPositionMechanics } from "@/lib/constants/cabinetMechanicsTypes";
import { getCabinetPositions, getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { METRIC_TO_DOMAIN } from "./selectNppBill";
import { governingArchetypeModifiers } from "./governingArchetype";
import { nppAutonomyAtLeast } from "./featureFlag";
import { tallySeatsByParty } from "@/lib/turn/parliamentaryGovernment";

/** Economic/social ideology axis half-range (~-5..+5), matching governingAgenda. */
const POLICY_SCALE = 5;

/** Base weight split between ideology-fit, competence, and coalition standing. */
const FIT_WEIGHT = 1.0;
const COMPETENCE_WEIGHT = 1.0;
/** Coalition-standing weight: tilts senior posts toward the head's party + larger partners. */
const PARTY_WEIGHT = 0.6;
/** Per-post portfolio-affinity weight (the right specialist for the brief). */
const PORTFOLIO_WEIGHT = 0.5;
/** Extra standing the head-of-government's own party gets over coalition partners. */
const LEADER_PARTY_BONUS = 0.3;

/** Competence proxy sub-weights (sum to 1, so competence stays in [0,1]). */
const COMPETENCE_SUBWEIGHTS = {
  loyalty: 0.3,
  ambition: 0.2,
  influence: 0.3,
  favorability: 0.2,
} as const;

/** Agenda domains that load on the economic axis (vs everything else = social). */
const ECONOMIC_DOMAINS = new Set([
  "economic_growth",
  "employment",
  "poverty",
  "income_inequality",
  "fiscal",
  "workforce",
]);

function norm01(v: number, scale = 100): number {
  return Math.max(0, Math.min(1, v / scale));
}

function normPolicy(v: number): number {
  return Math.max(-1, Math.min(1, v / POLICY_SCALE));
}

export type PortfolioAxis = "economic" | "social" | "neutral";

/**
 * Classify a cabinet position by the dominant ideological axis of the metrics it
 * governs (its portfolio): economic ministries (finance, enterprise) vs social /
 * service ministries (health, education, justice). Positions whose metrics don't
 * map to any agenda domain are "neutral". Pure.
 */
export function positionAxis(
  mechanics: Pick<CabinetPositionMechanics, "nationalMetrics" | "regionalMetrics"> | undefined
): PortfolioAxis {
  if (!mechanics) return "neutral";
  let econ = 0;
  let social = 0;
  for (const m of [...mechanics.nationalMetrics, ...mechanics.regionalMetrics]) {
    const domain = METRIC_TO_DOMAIN[m.category]?.[m.metricId];
    if (!domain) continue;
    if (ECONOMIC_DOMAINS.has(domain)) econ++;
    else social++;
  }
  if (econ === 0 && social === 0) return "neutral";
  return econ >= social ? "economic" : "social";
}

/**
 * Portfolio affinity in [0,1]: how well a candidate suits a post, proxied by the
 * intensity of their conviction on the post's axis (an economically-passionate
 * NPP for a finance brief; a socially-driven NPP for health/justice). Neutral
 * posts give a flat 0.5 so they don't skew the assignment. Pure.
 */
export function portfolioAffinity(
  ideology: { economic: number; social: number },
  axis: PortfolioAxis
): number {
  if (axis === "neutral") return 0.5;
  return Math.abs(normPolicy(axis === "economic" ? ideology.economic : ideology.social));
}

export interface CabinetCandidate {
  nppId: ObjectId;
  name: string;
  party: string;
  ideology: { economic: number; social: number };
  personality: NPPPersonality;
  politicalInfluence: number;
  favorability: number;
  /**
   * Coalition standing in [0, ~1.3]: the party's seat share within the governing
   * bloc, plus a bonus for the head's own party. Larger partners and the head's
   * party win more (and more senior) posts. Defaults to 0 (single-party / unset).
   */
  partyWeight?: number;
}

export interface RankedCabinetCandidate extends CabinetCandidate {
  score: number;
}

/**
 * Pure, deterministic ranking of co-partisan candidates for the governing head.
 * Higher score = better fit. Ties break on influence, then favorability, then a
 * stable id ordering, so the same inputs always produce the same cabinet.
 */
export function rankCabinetCandidates(
  candidates: CabinetCandidate[],
  head: { ideology: { economic: number; social: number }; personality: NPPPersonality }
): RankedCabinetCandidate[] {
  const ideologyWeightMult = governingArchetypeModifiers(head.personality).ideologyWeightMult;
  const headEcon = normPolicy(head.ideology.economic);
  const headSocial = normPolicy(head.ideology.social);

  const scored = candidates.map((c): RankedCabinetCandidate => {
    // Ideology-fit in [0,1]: 1 = identical stance to the head, 0 = maximally
    // opposed. Each axis distance is in [0,2] (normPolicy ∈ [-1,1]), so the
    // two-axis sum (max 4) is normalised by 4 to keep fit bounded against the
    // similarly-bounded competence term and the archetype multiplier.
    const distance =
      (Math.abs(normPolicy(c.ideology.economic) - headEcon) +
        Math.abs(normPolicy(c.ideology.social) - headSocial)) /
      4;
    const ideologyFit = 1 - distance;

    const competence =
      COMPETENCE_SUBWEIGHTS.loyalty * norm01(c.personality.loyalty) +
      COMPETENCE_SUBWEIGHTS.ambition * norm01(c.personality.ambition) +
      COMPETENCE_SUBWEIGHTS.influence * norm01(c.politicalInfluence) +
      COMPETENCE_SUBWEIGHTS.favorability * norm01(c.favorability);

    // Base (post-independent) score: ideological coherence with the head +
    // competence + coalition standing. Portfolio affinity is added per-post at
    // assignment time.
    const score =
      FIT_WEIGHT * ideologyWeightMult * ideologyFit +
      COMPETENCE_WEIGHT * competence +
      PARTY_WEIGHT * (c.partyWeight ?? 0);
    return { ...c, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.politicalInfluence !== a.politicalInfluence)
      return b.politicalInfluence - a.politicalInfluence;
    if (b.favorability !== a.favorability) return b.favorability - a.favorability;
    return a.nppId.toString() < b.nppId.toString() ? -1 : 1;
  });
  return scored;
}

export interface FormNppCabinetResult {
  /** Whether the v1 gate was met and a formed NPP government was present. */
  ran: boolean;
  /** Number of vacant cabinet posts filled this call. */
  filled: number;
  /** The position ids filled this call (seniority order). */
  filledPositionIds: string[];
}

const INACTIVE: FormNppCabinetResult = { ran: false, filled: 0, filledPositionIds: [] };

/**
 * Fill `countryId`'s vacant cabinet posts with co-partisan NPPs when an NPP head
 * of government is seated. Returns what was filled this call.
 */
export async function formNppCabinet(
  db: Db,
  countryId: CountryId,
  now: Date
): Promise<FormNppCabinetResult> {
  // V1 gate — also enforces the player rail (false below v2 in player countries).
  if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) return INACTIVE;

  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov || gov.status !== "formed") return INACTIVE;

  // Head of government must be an NPP — a player-held head has no NPP brain.
  const headNppId = gov.presidentNppId ?? gov.pmNppId ?? null;
  if (!headNppId) return INACTIVE;

  // Appointable posts: everything except the head-of-government seat, which is
  // seated via the executive-formation flow, not the cabinet flow. Era-gated
  // seats are excluded — an autonomous NPP government must not fill offices
  // that do not exist at the live year.
  const positions = resolveCabinetRoster(
    getCabinetPositions(countryId),
    await getLiveGameYear(db)
  ).filter((p) => !p.isHeadOfGovernment);
  if (positions.length === 0) return { ran: true, filled: 0, filledPositionIds: [] };

  // Idempotency: only fill posts that have no current holder.
  const cabinetCol = getCabinetMembersCollection(db);
  const existing = await cabinetCol.find({ countryId }).toArray();
  const filledPositionIds = new Set(existing.map((m) => m.positionId));
  const seatedNppIds = new Set(
    existing.filter((m) => m.isNPP && m.nppId).map((m) => m.nppId!.toString())
  );
  const vacant = positions.filter((p) => !filledPositionIds.has(p.id));
  if (vacant.length === 0) return { ran: true, filled: 0, filledPositionIds: [] };

  const headNpp = await db.collection<NPP>("npps").findOne({ _id: headNppId });
  if (!headNpp) return INACTIVE;
  const governingPartyId = gov.governingPartyId ?? headNpp.party;

  // Governing bloc: the head's party plus any coalition partners. In a coalition
  // government (e.g. IE), junior partners share the cabinet rather than the lead
  // party taking every seat.
  const blocParties = new Set<string>([governingPartyId, ...(gov.coalitionPartyIds ?? [])]);
  // Tallied live from electedOfficials rather than trusting
  // `gov.seatsByParty`, which is a write-triggered cache refreshed only on
  // specific turn events (NC-vote resolution, cycle rollover, PM appointment)
  // and can drift arbitrarily far from the real chamber between them —
  // measured in the field at 0 seats against real totals of 513/360 (BR/NG)
  // and 630 against a real 487 (DE). A stale zero here would starve the
  // governing bloc's coalition-standing weight and skew cabinet assignment.
  const seats = await tallySeatsByParty(db, countryId);
  const blocSeatTotal = [...blocParties].reduce((sum, p) => sum + (seats[p] ?? 0), 0) || 1;
  const partyWeightFor = (party: string): number =>
    (seats[party] ?? 0) / blocSeatTotal + (party === governingPartyId ? LEADER_PARTY_BONUS : 0);

  // Candidate pool: active bloc NPPs who are neither the head nor an
  // already-seated cabinet member.
  const poolDocs = await db
    .collection<NPP>("npps")
    .find({ countryId, party: { $in: [...blocParties] }, retiredAt: null })
    .toArray();
  const candidates: CabinetCandidate[] = poolDocs
    .filter((n) => !n._id.equals(headNppId) && !seatedNppIds.has(n._id.toString()))
    .map((n) => ({
      nppId: n._id,
      name: n.name,
      party: n.party,
      ideology: { economic: n.policies?.economic ?? 0, social: n.policies?.social ?? 0 },
      personality: n.personality,
      politicalInfluence: n.politicalInfluence ?? 0,
      favorability: n.favorability ?? 0,
      partyWeight: partyWeightFor(n.party),
    }));
  if (candidates.length === 0) return { ran: true, filled: 0, filledPositionIds: [] };

  const ranked = rankCabinetCandidates(candidates, {
    ideology: { economic: headNpp.policies?.economic ?? 0, social: headNpp.policies?.social ?? 0 },
    personality: headNpp.personality,
  });

  // Greedy assignment by seniority: each vacant post (most senior first) takes
  // the best-remaining candidate by base score + portfolio affinity for that
  // post's brief. Deterministic — `ranked` is a stable order, and the strict `>`
  // keeps the higher base candidate on ties.
  const vacantBySeniority = [...vacant].sort((a, b) => a.order - b.order);
  const remaining = [...ranked];
  const assigned: string[] = [];

  for (const position of vacantBySeniority) {
    if (remaining.length === 0) break;
    const axis = positionAxis(getCabinetMechanics(countryId, position.id));
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const s = cand.score + PORTFOLIO_WEIGHT * portfolioAffinity(cand.ideology, axis);
      if (s > bestScore) {
        bestScore = s;
        bestIndex = i;
      }
    }
    const [pick] = remaining.splice(bestIndex, 1);

    // Direct-fill: no confirmation lifecycle (parliamentary/one-party model), so
    // confirmedAt === appointedAt. The NPP's own currentOffice is intentionally
    // left untouched so its v0 legislative behavior (seat, voting) is unchanged;
    // the cabinet membership lives authoritatively in cabinetMembers. The seat
    // records the minister's own party (which may be a coalition partner).
    await cabinetCol.updateOne(
      { countryId, positionId: position.id },
      {
        $set: {
          characterId: null,
          characterName: pick.name,
          party: pick.party,
          isNPP: true,
          nppId: pick.nppId,
          appointedByCharacterId: null,
          appointedByNppId: headNppId,
          appointedAt: now,
          confirmedAt: now,
          ...initialMinisterialActionFields(now),
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    assigned.push(position.id);
  }

  if (assigned.length > 0) {
    console.log(
      `[nppAutonomy] ${countryId}: NPP government filled ${assigned.length} cabinet post(s) (bloc lead ${governingPartyId})`
    );
  }

  return { ran: true, filled: assigned.length, filledPositionIds: assigned };
}
