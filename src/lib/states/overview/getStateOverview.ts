/**
 * Server-side aggregator for the State Overview tab (Phase 1).
 *
 * Reads:
 *   - statePartyOrg (per-state-per-party Org / Reg)
 *   - politicalParties (party abbreviation + color for display)
 *   - states (state GDP for the Economy summary)
 *   - electedOfficials (regional executive — via getRegionalExecutive)
 *   - elections + electionCandidates + electionVoteTally (Contested
 *     Primaries + Race Watchlist)
 *
 * Phase 1 ships placeholders for extended economy (gdpDeltaPct /
 * unemployment / sectors). Phase 4+ wires those.
 *
 * See plan §"Phase 1 — Task 1.2".
 */

import type { Db } from "mongodb";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  State,
  StateMetrics,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import { getRegionalExecutive } from "@/lib/states/regionalExecutive";
import { classifyRace } from "./hotRaces";
import type {
  ContestedPrimarySummary,
  HotRaceSummary,
  PartyOrgRow,
  StateOverviewResult,
} from "./types";

const NEUTRAL_PARTY_COLOR = "#6b6b7a";

/** Race Watchlist threshold — top-2 within this many percentage points. */
const WATCHLIST_MARGIN_PP = 15;

/**
 * Parse the trailing numeric district label out of a seat id like
 * `"US-house-AZ-7"` → `"7"`. Returns `undefined` when the seat id has no
 * meaningful number (e.g. `"US-house-AZ"` — single-district map cell or a
 * legacy row missing its district number) so the UI falls back to the
 * plain race-type label rather than printing the raw seat id.
 */
function parseDistrictLabel(seatId: string | undefined | null): string | undefined {
  if (!seatId) return undefined;
  const tail = seatId.split("-").pop() ?? "";
  return /^\d+$/.test(tail) ? tail : undefined;
}

/** Convert SenateClass (1 | 2 | 3 | "I" | "II" | "III") to a plain number. */
function senateClassToNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "I") return 1;
    if (upper === "II") return 2;
    if (upper === "III") return 3;
    const n = Number(upper);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function getStateOverview(
  db: Db,
  args: { countryId: CountryId; stateId: string }
): Promise<StateOverviewResult> {
  const { countryId, stateId } = args;
  const now = new Date();

  // Fetch the Phase-1 data dependencies in parallel.
  const [
    partyOrgRows,
    parties,
    stateDoc,
    regionalExecutive,
    activeElections,
    regPool,
    metricsDoc,
    gameStateDoc,
  ] = await Promise.all([
    db.collection<StatePartyOrg>("statePartyOrg").find({ countryId, stateId }).toArray(),
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db.collection<State>("states").findOne({ _id: stateId, countryId }),
    getRegionalExecutive(db, countryId, stateId),
    db
      .collection<Election>("elections")
      .find({
        countryId,
        state: stateId,
        status: { $in: ["active", "upcoming"] },
      })
      .toArray(),
    db.collection<StateRegistrationPool>("stateRegistrationPool").findOne({ countryId, stateId }),
    // SP5: merged two-store view.
    findMergedRegionMetrics(db, { _id: stateId, countryId }),
    db.collection<{ _id: string; currentTurn?: number }>("gameState").findOne({ _id: "current" }),
  ]);

  const currentTurn = gameStateDoc?.currentTurn ?? null;

  // Index parties by `sequentialId` for cheap lookups. `StatePartyOrg.partyId`
  // is the sequentialId (as a string), not the ObjectId — see existing
  // patterns in `getRegionPartyOrg` and `getRegionOfficials`.
  const partyBySequentialId = new Map<string, PoliticalParty>();
  for (const p of parties) partyBySequentialId.set(String(p.sequentialId), p);

  // Build the per-party rows.
  const partyOrg: PartyOrgRow[] = partyOrgRows.map((row) => {
    const party = partyBySequentialId.get(row.partyId);
    return {
      id: row.partyId,
      abbr: party?.abbreviation ?? row.partyId.toUpperCase(),
      color: party?.color ?? NEUTRAL_PARTY_COLOR,
      orgPct: row.organization ?? 0,
      regPct: row.registration ?? 0,
    };
  });
  // Sort by Org desc with a deterministic alphabetical tiebreak so equal-Org
  // states render the same row on every fetch.
  partyOrg.sort((a, b) => {
    if (b.orgPct !== a.orgPct) return b.orgPct - a.orgPct;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const sumOrg = partyOrg.reduce((acc, r) => acc + r.orgPct, 0);
  const unaffiliatedPct = Math.max(0, 100 - sumOrg);

  const top = partyOrg[0];
  const topPartyId = top?.id ?? "";
  const topPartyOrgPct = top?.orgPct ?? 0;
  const topPartyRegPct = top?.regPct ?? 0;

  // regSource reflects whether the *top* party has a real Reg field — that's
  // what the KPI strip displays. A tiny third party having a real value
  // doesn't make the headline number "real" if the headline party doesn't.
  const topRow = top ? partyOrgRows.find((r) => r.partyId === top.id) : undefined;
  const regSource: "field" | "derived" = topRow?.registration != null ? "field" : "derived";

  const gdp = stateDoc?.gdp ?? 0;

  // ─── Election-derived fields ──────────────────────────────────────────────
  const { contestedPrimaries, hotRaces } = await buildElectionDerived({
    db,
    activeElections,
    partyBySequentialId,
    now,
    currentTurn,
  });

  // Build the Reg pool for the UI. Filter to parties with non-zero Reg —
  // a state-row may have 0 values for parties that aren't seeded for this
  // state's lane (per design doc §4.4 invariant). Independent /
  // Unregistered come from the state-level pool row.
  const regSeeded = regSource === "field";
  const registrationPool = {
    parties: regSeeded
      ? partyOrg
          .filter((p) => p.regPct > 0)
          .map((p) => ({ id: p.id, abbr: p.abbr, color: p.color, regPct: p.regPct }))
      : [],
    independent: regPool?.independent ?? 0,
    unregistered: regPool?.unregistered ?? 0,
    seeded: regSeeded,
  };

  return {
    stateId,
    countryId,
    kpis: {
      topPartyId,
      topPartyOrgPct,
      topPartyRegPct,
      regSource,
      gdp,
      competitiveRacesCount: hotRaces.length,
    },
    partyOrg,
    unaffiliatedPct,
    registrationPool,
    regionalExecutive,
    hotRaces,
    contestedPrimaries,
    economy: {
      gdp,
      gdpDeltaPct: 0,
      topSectors: buildTopSectors(stateDoc),
      unemployment: metricsDoc?.economic?.unemploymentRate?.value ?? 0,
    },
  };
}

/**
 * Pick the state's top sectors. Prefers the live per-turn
 * `topSectorsCache` (computed by `processTopSectorsRecompute`) and
 * falls back to the seed `sectorSpecializations` when the cache is
 * empty — fresh-reset worlds and states with no corporate activity yet
 * still get a populated card.
 *
 * `specializationBonus` is `"primary"` / `"secondary"` when a live top
 * sector matches the state's seed spec (and carries the +10pp / +5pp
 * regional margin bonus), and `null` otherwise. The fallback path
 * tags its two synthesized rows directly.
 *
 * `share` stays at `0` — the UI only renders the sector list, not the
 * share, so a real revenue figure is a future enhancement.
 */
function buildTopSectors(
  stateDoc: State | null
): Array<{ id: string; share: number; specializationBonus: "primary" | "secondary" | null }> {
  const cache = stateDoc?.topSectorsCache;
  if (cache && cache.sectors.length > 0) {
    return cache.sectors.map((s) => ({
      id: s.sectorType,
      share: 0,
      specializationBonus: s.specializationBonus,
    }));
  }
  const spec = stateDoc?.sectorSpecializations;
  if (!spec) return [];
  const out: Array<{
    id: string;
    share: number;
    specializationBonus: "primary" | "secondary" | null;
  }> = [];
  if (spec.primary) out.push({ id: spec.primary, share: 0, specializationBonus: "primary" });
  if (spec.secondary && spec.secondary !== spec.primary) {
    out.push({ id: spec.secondary, share: 0, specializationBonus: "secondary" });
  }
  return out;
}

/**
 * Pulls active candidates + vote tallies for the supplied elections,
 * classifies each by primary / general phase, and produces:
 *   - contestedPrimaries: one entry per (election × party) where the party
 *     fields 2+ active candidates in a primary-phase race
 *   - hotRaces: general-phase races where the top-2 candidates' actual
 *     vote share is within `WATCHLIST_MARGIN_PP` percentage points
 *
 * General-phase classification is strict: an election only counts as
 * "general phase" when its `primaryEndTime` is set AND already past. A
 * missing or future `primaryEndTime` keeps the race out of the watchlist.
 *
 * Vote shares come from `electionVoteTally.totalVotes` — the same source
 * the polling chart on the election detail page uses, so the watchlist's
 * margin matches what the player sees on the polling card.
 */
async function buildElectionDerived(args: {
  db: Db;
  activeElections: Election[];
  partyBySequentialId: Map<string, PoliticalParty>;
  now: Date;
  currentTurn: number | null;
}): Promise<{ contestedPrimaries: ContestedPrimarySummary[]; hotRaces: HotRaceSummary[] }> {
  const { db, activeElections, partyBySequentialId, now, currentTurn } = args;

  if (activeElections.length === 0) {
    return { contestedPrimaries: [], hotRaces: [] };
  }

  const electionIds = activeElections.map((e) => e._id);
  const [candidates, tallies] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
  ]);

  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of candidates) {
    const key = c.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(c);
    candidatesByElection.set(key, list);
  }

  const tallyByElection = new Map<string, ElectionVoteTally>();
  for (const t of tallies) tallyByElection.set(t.electionId.toString(), t);

  const contestedPrimaries: ContestedPrimarySummary[] = [];
  const hotRaces: HotRaceSummary[] = [];

  for (const election of activeElections) {
    const list = candidatesByElection.get(election._id.toString()) ?? [];
    if (list.length === 0) continue;

    // Turn-first phase classification (drift-immune; matches the engine and
    // the rest of the app) with a wall-clock fallback for legacy rows that
    // pre-date `primaryEndTurn`. Strict gates: a race only counts as
    // primary-phase if it has a primary end still in the future, and only
    // counts as general-phase if its primary end is set AND already past —
    // pre-primary (no primary bound) races are excluded from both lists.
    const primaryEnd = election.primaryEndTime ? new Date(election.primaryEndTime) : null;
    const hasPrimaryBound = typeof election.primaryEndTurn === "number" || primaryEnd != null;
    const primaryEnded =
      typeof election.primaryEndTurn === "number" && currentTurn != null
        ? currentTurn >= election.primaryEndTurn
        : primaryEnd != null && now >= primaryEnd;
    const inPrimary = hasPrimaryBound && !primaryEnded;
    const inGeneral = hasPrimaryBound && primaryEnded && election.status === "active";

    const districtLabel = parseDistrictLabel(election.seatId);
    const senateClass = senateClassToNumber(election.senateClass);

    if (inPrimary) {
      const byParty = new Map<string, ElectionCandidate[]>();
      for (const c of list) {
        const arr = byParty.get(c.party) ?? [];
        arr.push(c);
        byParty.set(c.party, arr);
      }
      for (const [partyId, candList] of byParty) {
        if (candList.length < 2) continue;
        const party = partyBySequentialId.get(partyId);
        contestedPrimaries.push({
          electionId: election._id.toString(),
          electionType: election.electionType,
          district: districtLabel,
          senateClass,
          partyId,
          partyAbbr: party?.abbreviation ?? partyId,
          partyColor: party?.color ?? NEUTRAL_PARTY_COLOR,
          candidateCount: candList.length,
          // Prefer the human-readable seatId (e.g. "US-house-AZ") over the
          // raw ObjectId — matches the convention used by every other
          // /elections/* link in the app (Navbar, country overview,
          // electionsHelpers). Falls back to the ObjectId for legacy
          // elections without a seatId backfilled.
          url: `/elections/${election.seatId ?? election._id.toString()}`,
        });
      }
      continue;
    }

    if (!inGeneral) continue;

    // Use the actual vote tally for vote-share margin (matches the
    // polling chart on the election detail page).
    const tally = tallyByElection.get(election._id.toString());
    if (!tally) continue; // No tally yet → skip rather than fake numbers.

    const activeIds = new Set(list.map((c) => c._id.toString()));
    const activeVotes = Object.entries(tally.totalVotes)
      .filter(([cid, votes]) => activeIds.has(cid) && votes > 0)
      .map(([cid, votes]) => ({ cid, votes }));
    if (activeVotes.length < 2) continue;

    const totalVotes = activeVotes.reduce((sum, v) => sum + v.votes, 0);
    if (totalVotes <= 0) continue;

    const sharesPct = activeVotes.map((v) => (v.votes / totalVotes) * 100).sort((a, b) => b - a);
    const topTwoMargin = Math.abs(sharesPct[0] - sharesPct[1]);
    if (topTwoMargin > WATCHLIST_MARGIN_PP) continue;

    const status = classifyRace({
      topTwoMargin,
      hasIncumbent: false,
      phase: "general",
    });

    hotRaces.push({
      electionId: election._id.toString(),
      electionType: election.electionType,
      district: districtLabel,
      senateClass,
      status,
      topTwoMargin,
      url: `/elections/${election.seatId ?? election._id.toString()}`,
    });
  }

  hotRaces.sort((a, b) => a.topTwoMargin - b.topTwoMargin);
  contestedPrimaries.sort((a, b) => {
    if (a.electionId !== b.electionId) return a.electionId < b.electionId ? -1 : 1;
    return a.partyAbbr < b.partyAbbr ? -1 : a.partyAbbr > b.partyAbbr ? 1 : 0;
  });

  return { contestedPrimaries, hotRaces };
}
