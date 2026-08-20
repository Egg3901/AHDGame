/**
 * German Question — balance / viability simulation.
 *
 * Drives the REAL phase-1 modules (resolvePlayBatch, rollInstitutionDrift,
 * recomputePosition, nextHeat, outcomeFor) turn by turn under five different
 * player behaviours, so the numbers below are the shipped arithmetic rather than
 * a separate model of it.
 *
 * WHAT IS MODELLED
 *   - Seat AP budget per turn and banked seat capital (accrual + cap) exactly as
 *     configured.
 *   - The personal tier, with a configurable head-count and East/West split,
 *     through the same net cap the phase applies.
 *   - Ladder heat, its coercive cap and its decay.
 *   - Bonn's drift, seeded per turn, so a scenario is reproducible.
 *
 * WHAT IS NOT MODELLED, DELIBERATELY
 *   Treasury is unbounded here. No per-turn national income exists in phase 1,
 *   and inventing one would bake a guess into the headline result. Instead the
 *   sim records each seat's cumulative spend and reports the burn rate against
 *   the on-hand balances the source design shows, so treasury pressure surfaces
 *   as a finding rather than as an assumption.
 */
import { ObjectId } from "mongodb";
import {
  HUNDREDTHS,
  SEAT_CAPITAL_CAP,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_PLAYS,
  TOTAL_INSTITUTION_WEIGHT,
  getSeat,
  type SettlementPlayDef,
  type SettlementSeatKey,
} from "../../src/lib/constants/settlementCrisis";
import type { SettlementInstitutionState } from "../../src/lib/db/types/settlementCrisis";
import type { SettlementPlayDoc } from "../../src/lib/db/types/settlementPlay";
import { applyToInstitution, recomputePosition } from "../../src/lib/settlement/position";
import { driftSeedFor, rollInstitutionDrift } from "../../src/lib/settlement/drift";
import { resolvePlayBatch } from "../../src/lib/settlement/resolvePlays";
import { nextHeat, outcomeFor } from "../../src/lib/settlement/outcome";
import { makeSeededRng } from "../../src/lib/events/substrate/rng";

const MAX_TURNS = 200;

/** On-hand treasury from the source design, for the burn-rate report. */
const OPENING_TREASURY: Record<SettlementSeatKey, { amount: number; label: string }> = {
  US: { amount: 2_410_000_000, label: "$2.41B" },
  UK: { amount: 480_000_000, label: "£480M" },
  RU: { amount: 1_240_000_000, label: "₽1.24B" },
  DD: { amount: 310_000_000, label: "ℳ310M" },
};

/** Opening capital banks from the source design. */
const OPENING_CAPITAL: Record<SettlementSeatKey, number> = { US: 60, UK: 41, RU: 60, DD: 48 };

/** Which way a seat pushes. East = toward reunification. */
const EAST_SEATS = new Set<SettlementSeatKey>(["DD", "RU"]);
const directionOf = (seat: SettlementSeatKey): 1 | -1 => (EAST_SEATS.has(seat) ? 1 : -1);

interface SeatRuntime {
  id: SettlementSeatKey;
  capital: number;
  /** Unspent action points carried forward, when banking is enabled. */
  bankedAp: number;
  spent: number;
  committed: number;
  playCount: number;
  playsUsed: Set<string>;
}

interface Scenario {
  name: string;
  blurb: string;
  /** Seats that actually play. Others sit the crisis out. */
  active: SettlementSeatKey[];
  /** Seats that prefer coercive plays where one is available. */
  coercive?: SettlementSeatKey[];
  /** Characters taking a personal play each turn. */
  personalCount?: number;
  /** Share of those pushing East, 0..1. */
  personalEastShare?: number;
  /** Carry unspent AP forward, so 2-3 AP plays become reachable. */
  apBanking?: boolean;
  /** What-if: override a seat's AP budget to test a proposed rebalance. */
  apOverride?: Partial<Record<SettlementSeatKey, number>>;
  /** What-if: reprice play magnitudes (playId → hundredths). */
  magnitudeOverride?: Record<string, number>;
}

/**
 * Apply a what-if magnitude reprice. Returns a catalogue copy — the shipped
 * config is never mutated, so a scenario cannot leak into the next one.
 */
function repricedCatalogue(
  seat: SettlementSeatKey,
  overrides: Record<string, number> | undefined
): SettlementPlayDef[] {
  const base = SETTLEMENT_PLAYS.filter((p) => p.seat === seat);
  if (!overrides) return base;
  return base.map((p) => (overrides[p.id] ? { ...p, magnitude: overrides[p.id] } : p));
}

/**
 * Index movement one play buys per action point.
 *
 * Must be weighted, not raw. A play against `garrison` (weight 3) moves the
 * index by 0.3 of its magnitude while one against `laender` (weight 2) moves it
 * by 0.2, and a SETTLEMENT-level play moves the index by its full magnitude
 * because it is added equally to every institution. Ranking on raw magnitude
 * makes the strongest play in the game — the GDR's joint referendum, worth
 * 3.33 index/AP against `aid`'s 1.6 — look like the weakest.
 */
function indexRate(play: SettlementPlayDef, multiplierPct: number): number {
  const weightShare =
    play.target === null
      ? 1
      : (SETTLEMENT_INSTITUTIONS.find((i) => i.id === play.target)?.weight ?? 0) /
        TOTAL_INSTITUTION_WEIGHT;
  return (((play.magnitude * multiplierPct) / 100) * weightShare) / play.actionCost;
}

/** Headroom left on an institution in the direction a seat is pushing. */
function headroom(
  institutions: readonly SettlementInstitutionState[],
  target: string | null,
  direction: 1 | -1
): number {
  if (target === null) return 10_000; // settlement-level plays never saturate
  const inst = institutions.find((i) => i.id === target);
  if (!inst) return 0;
  return direction === 1 ? 10_000 - inst.position : inst.position;
}

/**
 * Greedy per-turn plan for one seat: spend AP on the affordable plays with the
 * best index movement per action point.
 *
 * Saturation-aware. A naive rate-only greedy keeps hammering an institution
 * already pinned at 0 or 100 and reports a far weaker ceiling than a real
 * player would hit, so a play whose target has no headroom left is skipped and
 * the seat diversifies instead.
 */
function planSeatTurn(
  seat: SeatRuntime,
  prefersCoercive: boolean,
  institutions: readonly SettlementInstitutionState[],
  apBanking: boolean,
  apPerTurn: number,
  catalogue: SettlementPlayDef[]
): { plays: SettlementPlayDef[]; apLeft: number } {
  const def = getSeat(seat.id)!;
  let ap = apPerTurn + (apBanking ? seat.bankedAp : 0);
  let capital = seat.capital;
  const chosen: SettlementPlayDef[] = [];
  const direction = directionOf(seat.id);

  // Projected positions, so two plays in one turn do not both aim at the last
  // few points of headroom on the same institution.
  const projected = institutions.map((i) => ({ ...i }));

  for (;;) {
    const affordable = catalogue.filter(
      (p) =>
        p.actionCost <= ap &&
        p.capitalCost <= capital &&
        headroom(projected, p.target, direction) > 50
    );
    if (affordable.length === 0) break;

    affordable.sort((a, b) => {
      if (prefersCoercive && a.addsHeat !== b.addsHeat) return a.addsHeat ? -1 : 1;
      return indexRate(b, def.multiplierPct) - indexRate(a, def.multiplierPct);
    });

    const pick = affordable[0];
    chosen.push(pick);
    ap -= pick.actionCost;
    capital -= pick.capitalCost;

    const applied = Math.round((pick.magnitude * def.multiplierPct) / 100) * direction;
    if (pick.target === null) {
      for (const p of projected) p.position += applied;
    } else {
      const hit = projected.find((p) => p.id === pick.target);
      if (hit) hit.position += applied;
    }
  }
  return { plays: chosen, apLeft: ap };
}

function toPlayDoc(
  def: SettlementPlayDef,
  seat: SettlementSeatKey | null,
  direction: 1 | -1,
  turn: number
): SettlementPlayDoc {
  return {
    _id: new ObjectId(),
    crisisId: new ObjectId(),
    actor: seat ? "seat" : "personal",
    seatId: seat,
    characterId: new ObjectId(),
    countryId: null,
    playId: def.id,
    targetInstitutionId: def.target,
    direction,
    class: def.class,
    costs: { funds: def.fundsCost, capital: def.capitalCost, actions: def.actionCost },
    basePoints: def.magnitude,
    appliedPoints: null,
    heatAdded: def.addsHeat ? 1 : 0,
    turn,
    resolvedTurn: null,
    createdAt: new Date("1953-01-01T00:00:00Z"),
  };
}

interface Result {
  scenario: string;
  outcome: string;
  turns: number;
  finalIndex: number;
  peakIndex: number;
  troughIndex: number;
  maxHeat: number;
  armedTurns: number;
  seats: SeatRuntime[];
  personalRawPeak: number;
  personalCappedTurns: number;
}

function run(scenario: Scenario): Result {
  let institutions: SettlementInstitutionState[] = SETTLEMENT_INSTITUTIONS.map((i) => ({
    id: i.id,
    weight: i.weight,
    position: i.opening,
    lastPlay: null,
    lastDrift: 0,
  }));

  const seats = new Map<SettlementSeatKey, SeatRuntime>();
  for (const key of ["US", "UK", "RU", "DD"] as SettlementSeatKey[]) {
    seats.set(key, {
      id: key,
      capital: OPENING_CAPITAL[key],
      bankedAp: 0,
      spent: 0,
      committed: 0,
      playCount: 0,
      playsUsed: new Set(),
    });
  }

  const personalDefs = SETTLEMENT_PLAYS.filter((p) => p.seat === null);
  const coercive = new Set(scenario.coercive ?? []);

  let heat = 0;
  let maxHeat = 0;
  let armedTurns = 0;
  let peak = recomputePosition(institutions);
  let trough = peak;
  let personalRawPeak = 0;
  let personalCappedTurns = 0;
  let outcome: string = "unresolved";
  let turns = MAX_TURNS;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const docs: SettlementPlayDoc[] = [];

    for (const key of scenario.active) {
      const seat = seats.get(key)!;
      const apPerTurn = scenario.apOverride?.[key] ?? getSeat(key)!.actionsPerTurn;
      const { plays, apLeft } = planSeatTurn(
        seat,
        coercive.has(key),
        institutions,
        scenario.apBanking === true,
        apPerTurn,
        repricedCatalogue(key, scenario.magnitudeOverride)
      );
      for (const def of plays) {
        docs.push(toPlayDoc(def, key, directionOf(key), turn));
        seat.capital -= def.capitalCost;
        seat.spent += def.fundsCost;
        seat.playCount++;
        seat.playsUsed.add(def.id);
      }
      // Bank whatever went unspent, so the 2-3 AP plays become reachable next
      // turn. Capped at three turns' worth to stop indefinite hoarding.
      seat.bankedAp = scenario.apBanking ? Math.min(apLeft, apPerTurn * 3) : 0;
    }

    const headcount = scenario.personalCount ?? 0;
    const eastShare = scenario.personalEastShare ?? 0.5;
    for (let n = 0; n < headcount; n++) {
      const def = personalDefs[n % personalDefs.length];
      const dir: 1 | -1 = n < headcount * eastShare ? 1 : -1;
      docs.push(toPlayDoc(def, null, dir, turn));
    }

    const batch = resolvePlayBatch(docs);

    for (const [, raw] of batch.personalRaw) {
      personalRawPeak = Math.max(personalRawPeak, Math.abs(raw));
    }
    for (const [id, raw] of batch.personalRaw) {
      const applied = batch.personalApplied.get(id) ?? 0;
      if (Math.abs(raw) > Math.abs(applied) + 1) {
        personalCappedTurns++;
        break;
      }
    }

    // Credit committed points back to the seat that paid for them.
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    for (const stamp of batch.stamped) {
      const doc = byId.get(String(stamp.id));
      if (doc?.seatId) {
        seats.get(doc.seatId)!.committed += Math.abs(stamp.appliedPoints);
      }
    }

    const rng = makeSeededRng(driftSeedFor(turn));
    institutions = institutions.map((inst) => {
      const delta = (batch.perInstitution.get(inst.id) ?? 0) + batch.settlementDelta;
      const withPlays = applyToInstitution(inst, delta);
      const drift = rollInstitutionDrift({
        institutionId: inst.id,
        position: withPlays.position,
        rng,
      });
      return { ...applyToInstitution(withPlays, drift), lastDrift: drift };
    });

    heat = nextHeat({ current: heat, added: batch.heatAdded });
    maxHeat = Math.max(maxHeat, heat);
    if (heat >= 5) armedTurns++;

    for (const key of ["US", "UK", "RU", "DD"] as SettlementSeatKey[]) {
      const seat = seats.get(key)!;
      seat.capital = Math.min(SEAT_CAPITAL_CAP, seat.capital + getSeat(key)!.capitalPerTurn);
    }

    const position = recomputePosition(institutions);
    peak = Math.max(peak, position);
    trough = Math.min(trough, position);

    const settled = outcomeFor(position);
    if (settled) {
      outcome = settled === "challenger" ? "REUNIFICATION CARRIES" : "INDEPENDENCE HOLDS";
      turns = turn;
      break;
    }
  }

  return {
    scenario: scenario.name,
    outcome,
    turns,
    finalIndex: recomputePosition(institutions),
    peakIndex: peak,
    troughIndex: trough,
    maxHeat,
    armedTurns,
    seats: [...seats.values()],
    personalRawPeak,
    personalCappedTurns,
  };
}

const SCENARIOS: Scenario[] = [
  {
    name: "1. Superpower duel",
    blurb: "Washington and Moscow only. East Berlin and London sit it out.",
    active: ["US", "RU"],
  },
  {
    name: "2. East Berlin unleashed",
    blurb: "GDR + Moscow at full tilt; the West answers with both seats.",
    active: ["DD", "RU", "US", "UK"],
  },
  {
    name: "3. Western coalition unopposed",
    blurb: "US + UK push for the lock; neither Eastern seat contests it.",
    active: ["US", "UK"],
  },
  {
    name: "4. The street rises",
    blurb: "1,204 characters, 70% pushing East. All four seats play.",
    active: ["US", "UK", "RU", "DD"],
    personalCount: 1204,
    personalEastShare: 0.7,
  },
  {
    name: "5. Escalation spiral",
    blurb: "Both blocs lean on coercive plays. All four seats, no public.",
    active: ["US", "UK", "RU", "DD"],
    coercive: ["US", "RU", "DD"],
  },
  {
    name: "6. Same, with AP banking",
    blurb: "Scenario 5 with unspent AP carried forward — the open question #1 comparison.",
    active: ["US", "UK", "RU", "DD"],
    coercive: ["US", "RU", "DD"],
    apBanking: true,
  },
  {
    name: "7. WHAT-IF: secondaries at 2 AP",
    blurb: "Scenario 2 with US/UK/RU on 2 AP, unlocking the 2 AP plays. Tests the fix.",
    active: ["DD", "RU", "US", "UK"],
    apOverride: { US: 2, UK: 2, RU: 2 },
  },
  {
    name: "8. WHAT-IF: 2 AP + public",
    blurb: "Scenario 7 plus 1,204 characters at 70% East.",
    active: ["DD", "RU", "US", "UK"],
    apOverride: { US: 2, UK: 2, RU: 2 },
    personalCount: 1204,
    personalEastShare: 0.7,
  },
  {
    // Multi-AP plays repriced so their index-per-AP is comparable to each
    // seat's 1 AP option. These are the ONLY levers on bundestag and garrison
    // (60% of the index weight), so while they stay dominated neither bloc
    // touches 60% of the board.
    name: "9. WHAT-IF: repriced + 2 AP",
    blurb: "Both fixes together — 2 AP secondaries AND repriced multi-AP plays, 70% East public.",
    active: ["DD", "RU", "US", "UK"],
    apOverride: { US: 2, UK: 2, RU: 2 },
    personalCount: 1204,
    personalEastShare: 0.7,
    magnitudeOverride: {
      ostpolitik: 10 * HUNDREDTHS, // 2 AP → bundestag
      pressure: 10 * HUNDREDTHS, // 2 AP → garrison
      terms: 16 * HUNDREDTHS, // 3 AP → bundestag
      article5: 10 * HUNDREDTHS, // 2 AP → garrison
      station: 10 * HUNDREDTHS, // 2 AP → street
      rhine: 7 * HUNDREDTHS, // 2 AP → garrison
    },
  },
  {
    name: "10. WHAT-IF: repriced + 2 AP, even public",
    blurb: "Scenario 9 with the public split evenly instead of 70% East.",
    active: ["DD", "RU", "US", "UK"],
    apOverride: { US: 2, UK: 2, RU: 2 },
    personalCount: 1204,
    personalEastShare: 0.5,
    magnitudeOverride: {
      ostpolitik: 10 * HUNDREDTHS,
      pressure: 10 * HUNDREDTHS,
      terms: 16 * HUNDREDTHS,
      article5: 10 * HUNDREDTHS,
      station: 10 * HUNDREDTHS,
      rhine: 7 * HUNDREDTHS,
    },
  },
];

const pts = (h: number) => (h / HUNDREDTHS).toFixed(1);

console.log("═".repeat(78));
console.log("GERMAN QUESTION — BALANCE SIMULATION");
console.log(`opening index ${pts(3820)}   carry ≥85.0   lock ≤15.0   cap ${MAX_TURNS} turns`);
console.log("═".repeat(78));

const results: Result[] = [];
for (const scenario of SCENARIOS) {
  const r = run(scenario);
  results.push(r);
  console.log(`\n${r.scenario}`);
  console.log(`   ${scenario.blurb}`);
  console.log(
    `   → ${r.outcome} at turn ${r.turns}` +
      `   final ${pts(r.finalIndex)}   range ${pts(r.troughIndex)}–${pts(r.peakIndex)}`
  );
  console.log(
    `   ladder peak rung ${r.maxHeat}` +
      (r.armedTurns ? `, armed for ${r.armedTurns} turns` : ", never armed")
  );
  if (scenario.personalCount) {
    console.log(
      `   public: peak raw ${pts(r.personalRawPeak)} on one institution, ` +
        `capped on ${r.personalCappedTurns}/${r.turns} turns`
    );
  }
  for (const seat of r.seats) {
    if (!scenario.active.includes(seat.id)) continue;
    const open = OPENING_TREASURY[seat.id];
    const burnTurns = seat.spent > 0 ? (open.amount / (seat.spent / r.turns)).toFixed(0) : "n/a";
    const catalogue = SETTLEMENT_PLAYS.filter((p) => p.seat === seat.id);
    const unreachable = catalogue.filter((p) => !seat.playsUsed.has(p.id)).map((p) => p.id);
    console.log(
      `   ${seat.id.padEnd(3)} ${String(seat.playCount).padStart(4)} plays` +
        `  committed ${pts(seat.committed).padStart(7)}` +
        `  capital left ${String(seat.capital).padStart(2)}` +
        `  spend/turn ${(seat.spent / r.turns / 1e6).toFixed(1).padStart(6)}M` +
        `  exhausts ${open.label} in ${burnTurns} turns`
    );
    if (unreachable.length > 0) {
      console.log(
        `       never played (${unreachable.length}/${catalogue.length}): ${unreachable.join(", ")}`
      );
    }
  }
}

console.log(`\n${"═".repeat(78)}`);
console.log("SUMMARY");
console.log("═".repeat(78));
for (const r of results) {
  console.log(
    `${r.scenario.padEnd(28)} ${r.outcome.padEnd(22)} turn ${String(r.turns).padStart(3)}   final ${pts(r.finalIndex).padStart(5)}`
  );
}
