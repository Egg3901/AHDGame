/**
 * Admin-only, client-side election-night simulation.
 *
 * Takes a real results response and replays a compressed election night from
 * it: synthesized final vote totals, units revealing one by one, calls
 * cascading in, seat/EV projections solidifying. Pure and seeded — no writes,
 * no API calls — and it runs through the SAME compute functions as the live
 * endpoint, so what the admin previews is exactly what players will see.
 */

import {
  computeElectoralTotals,
  computeNationalProjection,
  computeUnitResult,
  hashFraction,
  unitRevealOffset,
} from "./computeResults";
import type {
  ElectionResultsResponse,
  NationalParty,
  NationalRegion,
  ResultsCandidate,
  ResultsUnit,
} from "./types";

/** Deterministic PRNG so a given seed replays the identical night. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAKE_PARTIES = [
  { name: "Unity Party", abbreviation: "UNI", color: "#3B82F6" },
  { name: "Heritage Alliance", abbreviation: "HER", color: "#EF4444" },
  { name: "Reform Movement", abbreviation: "REF", color: "#F59E0B" },
  { name: "Green Coalition", abbreviation: "GRN", color: "#22C55E" },
];

const FAKE_NAMES = ["Alex Morrow", "Jordan Blake", "Sam Whitfield", "Casey Trent"];

export interface SimulationScript {
  seed: number;
  base: ElectionResultsResponse;
  candidates: ResultsCandidate[];
  /** unitId -> candidateId -> synthesized final votes. */
  finalVotesByUnit: Record<string, Record<string, number>>;
  units: { id: string; name: string; weight: number }[];
}

/**
 * Build the fixed "script" for one simulated night: candidates (real ones, or
 * fabricated if the election has none) and a synthesized final tally per unit
 * with one candidate favored per unit so calls land both ways.
 */
export function buildSimulationScript(
  base: ElectionResultsResponse,
  seed: number
): SimulationScript {
  const rand = mulberry32(seed);

  let candidates: ResultsCandidate[] = base.candidates.map((c) => ({ ...c }));
  if (candidates.length === 0) {
    candidates = FAKE_PARTIES.slice(0, 3).map((p, i) => ({
      id: `sim-cand-${i}`,
      name: FAKE_NAMES[i],
      party: `sim-${i}`,
      partyName: p.name,
      partyColor: p.color,
      isNPP: true,
      totalVotes: 0,
      voteSharePct: 0,
    }));
  }

  let units = base.units.map((u) => ({ id: u.id, name: u.name, weight: u.weight }));
  if (units.length === 0) {
    // Nothing tallied yet (upcoming election) — fabricate a board so the
    // animation preview still has something to reveal.
    units = Array.from({ length: 18 }, (_, i) => ({
      id: `sim-unit-${i}`,
      name: `District ${String.fromCharCode(65 + i)}`,
      weight: 1 + Math.floor(rand() * 12),
    }));
  }

  // National vote-share baseline per candidate, then a per-unit tilt so units
  // split between the front-runners instead of sweeping one way.
  const nationalShare = candidates.map(() => 0.35 + rand());
  const finalVotesByUnit: Record<string, Record<string, number>> = {};
  for (const unit of units) {
    const unitVotes: Record<string, number> = {};
    const turnoutScale = 40_000 + rand() * 400_000;
    const favored = Math.floor(hashFraction(`${seed}:fav:${unit.id}`) * candidates.length);
    candidates.forEach((c, i) => {
      const tilt = i === favored ? 1.15 + rand() * 0.35 : 0.85 + rand() * 0.25;
      unitVotes[c.id] = Math.round(nationalShare[i] * tilt * turnoutScale);
    });
    finalVotesByUnit[unit.id] = unitVotes;
  }

  return { seed, base, candidates, finalVotesByUnit, units };
}

/** Smooth count-up: fast early returns, long tail — reads like real counting. */
function countCurve(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 2.2);
}

/**
 * One frame of the simulated night at `progress` (0..1 across the compressed
 * hour). Monotonic in progress: votes only climb, calls only accumulate.
 */
export function simulationFrame(
  script: SimulationScript,
  progress: number
): ElectionResultsResponse {
  const { base, candidates, finalVotesByUnit, units, seed } = script;
  const simElectionId = `sim:${seed}`;
  const isPresident = base.election.electionType === "president";

  const frameUnits: ResultsUnit[] = units.map((unit) => {
    const finals = finalVotesByUnit[unit.id];
    const reveal = unitRevealOffset(simElectionId, unit.id);
    // Counting starts immediately, completes at the unit's reveal moment.
    const counted = countCurve(progress / reveal);
    const votes: Record<string, number> = {};
    for (const [cid, finalV] of Object.entries(finals)) {
      // Per-candidate stagger: late-counting strongholds shift the lead as
      // returns come in, like real precinct geography.
      const lag = 0.75 + hashFraction(`${seed}:lag:${unit.id}:${cid}`) * 0.5;
      votes[cid] = Math.round(finalV * countCurve((progress * lag) / reveal));
      if (counted >= 1) votes[cid] = finalV;
    }
    return computeUnitResult({
      electionId: simElectionId,
      unitId: unit.id,
      name: unit.name,
      weight: unit.weight,
      votes,
      isEnded: false,
      baselineReportingPct: 5,
      finalHourProgress: progress,
    });
  });

  const { calledEv, leadingEv } = computeElectoralTotals(frameUnits);
  const totalEv = isPresident
    ? (base.election.totalEv ?? frameUnits.reduce((s, u) => s + u.weight, 0))
    : undefined;
  const evNeeded = totalEv ? Math.floor(totalEv / 2) + 1 : undefined;

  const totalsByCandidate: Record<string, number> = {};
  for (const unit of frameUnits) {
    for (const uc of unit.candidates) {
      totalsByCandidate[uc.candidateId] = (totalsByCandidate[uc.candidateId] ?? 0) + uc.votes;
    }
  }
  const grandTotal = Object.values(totalsByCandidate).reduce((s, v) => s + v, 0);

  // Multi-seat: apportion each unit's seats by its current vote split.
  const seatsByCandidate: Record<string, number> = {};
  if (!isPresident) {
    for (const unit of frameUnits) {
      const unitTotal = unit.candidates.reduce((s, c) => s + c.votes, 0);
      if (unitTotal === 0) continue;
      for (const uc of unit.candidates) {
        seatsByCandidate[uc.candidateId] =
          (seatsByCandidate[uc.candidateId] ?? 0) +
          Math.round((uc.votes / unitTotal) * unit.weight);
      }
    }
  }

  const frameCandidates: ResultsCandidate[] = candidates
    .map((c) => ({
      ...c,
      totalVotes: totalsByCandidate[c.id] ?? 0,
      voteSharePct: grandTotal > 0 ? ((totalsByCandidate[c.id] ?? 0) / grandTotal) * 100 : 0,
      ...(isPresident
        ? {
            electoralVotes: calledEv[c.id] ?? 0,
            leadingElectoralVotes: leadingEv[c.id] ?? 0,
          }
        : { seatsProjected: seatsByCandidate[c.id] ?? 0 }),
    }))
    .sort((a, b) => b.totalVotes - a.totalVotes);

  // National board: reuse the real regions if present, dealing seats from a
  // drifted copy of the real national party shares (so multi-party boards
  // stay multi-party, but every run lands differently); declared status
  // follows the drip.
  let national = base.national;
  if (national) {
    // Share basis: the real projection when it has data, else the simulated
    // local candidates' parties.
    const partySeatShare: Record<string, number> = {};
    for (const p of national.parties) {
      if (p.projectedSeats > 0) {
        const drift = 0.7 + hashFraction(`${seed}:drift:${p.party}`) * 0.6;
        partySeatShare[p.party] = p.projectedSeats * drift;
      }
    }
    if (Object.keys(partySeatShare).length === 0) {
      for (const c of frameCandidates) {
        partySeatShare[c.party] =
          (partySeatShare[c.party] ?? 0) + (c.seatsProjected ?? 0) + c.totalVotes * 1e-9;
      }
    }

    const regions: NationalRegion[] = national.regions.map((r) => {
      const declared = progress >= unitRevealOffset(simElectionId, `region:${r.electionId}`);
      // Jittered proportional weights, then exact largest-remainder allocation
      // so every region's parties sum to precisely its seat count.
      const weights = Object.entries(partySeatShare).map(([party, share]) => ({
        party,
        w: share * (0.6 + hashFraction(`${seed}:${r.electionId}:${party}`) * 0.8),
      }));
      const wTotal = weights.reduce((s, x) => s + x.w, 0) || 1;
      const allocs = weights.map(({ party, w }) => {
        const exact = (w / wTotal) * r.seats;
        return { party, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
      });
      let left = r.seats - allocs.reduce((s, a) => s + a.floor, 0);
      allocs.sort((a, b) => b.rem - a.rem);
      const seatsByParty: Record<string, number> = {};
      for (const a of allocs) {
        const extra = left > 0 ? 1 : 0;
        left -= extra;
        const seats = a.floor + extra;
        if (seats > 0) seatsByParty[a.party] = seats;
      }
      return { ...r, declared, seatsByParty };
    });

    const projectedByParty: Record<string, number> = {};
    const declaredByParty: Record<string, number> = {};
    let regionsDeclared = 0;
    for (const r of regions) {
      if (r.declared) regionsDeclared++;
      for (const [party, seats] of Object.entries(r.seatsByParty)) {
        projectedByParty[party] = (projectedByParty[party] ?? 0) + seats;
        if (r.declared) declaredByParty[party] = (declaredByParty[party] ?? 0) + seats;
      }
    }
    const parties: NationalParty[] = national.parties
      .map((p) => ({
        ...p,
        projectedSeats: projectedByParty[p.party] ?? 0,
        declaredSeats: declaredByParty[p.party] ?? 0,
      }))
      .sort((a, b) => b.projectedSeats - a.projectedSeats);

    national = {
      ...national,
      regions,
      parties,
      regionsDeclared,
      projection: computeNationalProjection(parties, national.majorityThreshold, national.style),
    };
  }

  const unitsCalled = frameUnits.filter((u) => u.called).length;
  const decisive =
    isPresident && evNeeded
      ? (frameCandidates.find((c) => (c.electoralVotes ?? 0) >= evNeeded)?.id ?? null)
      : null;

  return {
    ...base,
    election: {
      ...base.election,
      status: "active",
      evNeeded,
      totalEv,
      finalHour: { progress, endsAt: base.election.finalHour?.endsAt ?? "" },
    },
    candidates: frameCandidates,
    units: frameUnits,
    national,
    summary: {
      totalVotes: grandTotal,
      unitsReporting: frameUnits.filter((u) => u.totalVotes > 0).length,
      totalUnits: frameUnits.length,
      unitsCalled,
      projectedWinner: decisive,
    },
    lastUpdated: base.lastUpdated,
    simulated: true,
  };
}
