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
  getPlay,
  getSeat,
  personalNetCapFor,
  seatActionBankCap,
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
import { capitalPriceFor } from "../../src/lib/settlement/capitalPrice";

/**
 * 480 turns — ten in-game years at 48 turns to the year.
 *
 * The brief is at least three in-game years unopposed, so the cap has to leave
 * room to show a contested question NOT resolving well past that; a cap only
 * a little above the target would report every long game as a stall.
 */
const MAX_TURNS = 480;

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
  /**
   * Signed national cash position, seeded from OPENING_TREASURY. GOES NEGATIVE:
   * that is national debt, exactly as the shipped `commitPlay` allows. A floor,
   * not an economy — no national income is modelled here, because that figure
   * lives in the budget engine and a copy would go stale.
   */
  treasury: number;
  spent: number;
  /** Plays bought with political capital because cash would have borrowed. */
  capitalRouteCount: number;
  committed: number;
  playCount: number;
  playsUsed: Set<string>;
  playTally: Map<string, number>;
}

interface Scenario {
  name: string;
  blurb: string;
  /** Seats that actually play. Others sit the crisis out. */
  active: SettlementSeatKey[];
  /** Seats that prefer coercive plays where one is available. */
  coercive?: SettlementSeatKey[];
  /**
   * How often a seat actually shows up, 0..1. 1 = every turn, 0.5 = every
   * other, 0.25 = one turn in four. Deterministic rather than random so a run
   * is reproducible.
   *
   * The original scenarios were all-or-nothing — a seat played optimally every
   * single turn or sat the whole crisis out. Nobody plays like that, and the
   * gap matters: AP and capital BANK, so a seat at half effort is not half as
   * effective. It saves up and spends bigger.
   */
  effort?: Partial<Record<SettlementSeatKey, number>>;
  /** Characters taking a personal play each turn. */
  personalCount?: number;
  /** Share of those pushing East, 0..1. */
  personalEastShare?: number;
  /** What-if: override a seat's AP budget to test a proposed rebalance. */
  apOverride?: Partial<Record<SettlementSeatKey, number>>;
  /** What-if: reprice play magnitudes (playId → hundredths). */
  magnitudeOverride?: Record<string, number>;
  /**
   * Seats refuse to run the treasury negative, buying with political capital
   * instead once cash runs short.
   *
   * OFF by default, because borrowing without limit is what the game actually
   * permits: `commitPlay` has no balance guard and `spendFromTreasury` books
   * the shortfall as national debt. Turning it on models a POLICY, not a rule —
   * a delegation that will not indebt its country — and it is the only way to
   * see the capital payment route exercised, since this sim models none of
   * debt's consequences (interest, credit rating, debt-to-GDP) and so an
   * in-sim borrower is strictly better off than one who pays capital.
   */
  noBorrow?: boolean;
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
  apPerTurn: number,
  catalogue: SettlementPlayDef[],
  noBorrow: boolean
): { plays: SettlementPlayDef[]; apLeft: number } {
  const def = getSeat(seat.id)!;
  // AP is a BANK, exactly as the shipped `accrue` treats it: this turn's grant
  // on top of whatever went unspent.
  let ap = apPerTurn + seat.bankedAp;
  let capital = seat.capital;
  let treasury = seat.treasury;
  const chosen: SettlementPlayDef[] = [];
  const direction = directionOf(seat.id);

  // Projected positions, so two plays in one turn do not both aim at the last
  // few points of headroom on the same institution.
  const projected = institutions.map((i) => ({ ...i }));

  /**
   * Price a play the way this seat's policy would buy it.
   *
   * Under `noBorrow` a play the cash on hand cannot cover switches to the
   * political-capital route. Without it the seat simply borrows, which is what
   * the shipped command allows, and the treasury goes negative.
   *
   * Repriced INSIDE the loop, because three plays in one turn can take the
   * treasury through zero. Returning a repriced def rather than a wrapper lets
   * the whole save-rather-than-settle algorithm below run unchanged on
   * `capitalCost`.
   */
  const priced = (p: SettlementPlayDef): SettlementPlayDef =>
    noBorrow && p.fundsCost > 0 && p.fundsCost > treasury
      ? { ...p, capitalCost: capitalPriceFor(p), fundsCost: 0 }
      : p;

  for (;;) {
    const reachable = catalogue
      .filter((p) => p.actionCost <= ap && headroom(projected, p.target, direction) > 50)
      .map(priced);
    const affordable = reachable.filter((p) => p.capitalCost <= capital);
    if (affordable.length === 0) break;

    const byRate = (a: SettlementPlayDef, b: SettlementPlayDef) => {
      if (prefersCoercive && a.addsHeat !== b.addsHeat) return a.addsHeat ? -1 : 1;
      return indexRate(b, def.multiplierPct) - indexRate(a, def.multiplierPct);
    };
    affordable.sort(byRate);

    // SAVE rather than settle. A greedy seat spends its capital on whatever it
    // can afford right now, which on this catalogue means buying `border` at
    // 1.60 index/AP and never accumulating the 22 for `referendum` at 3.33.
    // That made an ABSENT seat look stronger than a present one — it banked
    // capital by accident and bought the better play. A real operator would
    // simply wait, so the model has to as well, or every effort comparison
    // measures the planner instead of the game.
    const best = [...reachable].sort(byRate)[0];
    const pick = affordable[0];
    if (
      best &&
      best.capitalCost > capital &&
      indexRate(best, def.multiplierPct) > indexRate(pick, def.multiplierPct) &&
      pick.capitalCost > 0
    ) {
      // Spend AP on capital-free plays only; hold the pool for the better one.
      const free = affordable.filter((p) => p.capitalCost === 0);
      if (free.length === 0) break;
      free.sort(byRate);
      const freePick = free[0];
      chosen.push(freePick);
      ap -= freePick.actionCost;
      treasury -= freePick.fundsCost;
      const appliedFree = Math.round((freePick.magnitude * def.multiplierPct) / 100) * direction;
      if (freePick.target === null) {
        for (const q of projected) q.position += appliedFree;
      } else {
        const hitFree = projected.find((q) => q.id === freePick.target);
        if (hitFree) hitFree.position += appliedFree;
      }
      continue;
    }
    chosen.push(pick);
    ap -= pick.actionCost;
    capital -= pick.capitalCost;
    treasury -= pick.fundsCost;

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
      treasury: OPENING_TREASURY[key].amount,
      spent: 0,
      capitalRouteCount: 0,
      committed: 0,
      playCount: 0,
      playsUsed: new Set(),
      playTally: new Map(),
    });
  }

  const personalDefs = SETTLEMENT_PLAYS.filter((p) => p.seat === null);
  const coercive = new Set(scenario.coercive ?? []);

  let heat = 0;
  let maxHeat = 0;
  let quietTurns = 0;
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
      // Absent this turn — but still accruing. That is the whole point of the
      // bank: a seat at quarter effort arrives with four turns of AP and
      // capital saved, so it plays the expensive cards the diligent seat
      // cannot afford to reach.
      const effort = scenario.effort?.[key] ?? 1;
      if (effort < 1) {
        const period = Math.max(1, Math.round(1 / effort));
        if (turn % period !== 0) {
          // AP only. Capital accrues for every seat at the end of the tick
          // below, played or not, so adding it here would pay twice.
          seat.bankedAp = Math.min(seat.bankedAp + apPerTurn, seatActionBankCap(apPerTurn));
          continue;
        }
      }
      const { plays, apLeft } = planSeatTurn(
        seat,
        coercive.has(key),
        institutions,
        apPerTurn,
        repricedCatalogue(key, scenario.magnitudeOverride),
        scenario.noBorrow ?? false
      );
      for (const def of plays) {
        docs.push(toPlayDoc(def, key, directionOf(key), turn));
        seat.capital -= def.capitalCost;
        // Signed: this is allowed to go negative, and that is national debt.
        seat.treasury -= def.fundsCost;
        seat.spent += def.fundsCost;
        // `planSeatTurn` zeroes `fundsCost` on a play it rerouted to capital,
        // so a play the catalogue charges money for that arrives here free was
        // bought with political capital instead.
        if (def.fundsCost === 0 && (getPlay(def.id)?.fundsCost ?? 0) > 0) {
          seat.capitalRouteCount++;
        }
        seat.playCount++;
        seat.playsUsed.add(def.id);
        seat.playTally.set(def.id, (seat.playTally.get(def.id) ?? 0) + 1);
      }
      // Bank whatever went unspent, under the shipped ceiling.
      seat.bankedAp = Math.min(apLeft, seatActionBankCap(apPerTurn));
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

    const ladder = nextHeat({ current: heat, added: batch.heatAdded, quietTurns });
    heat = ladder.heat;
    quietTurns = ladder.quietTurns;
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
  // ── The two bounds. Everything else has to sit between these. ────────────
  {
    name: "A. Western coalition unopposed",
    blurb: "US + UK at full effort; neither Eastern seat contests it.",
    active: ["US", "UK"],
  },
  {
    name: "B. Eastern coalition unopposed",
    blurb: "GDR + Moscow at full effort; neither Western seat contests it.",
    active: ["DD", "RU"],
  },

  // ── Five varying-effort runs. Effort is how often a seat shows up.
  //
  //    MIND THE BANK. AP banks for SEAT_ACTION_BANK_TURNS turns, so a seat that
  //    returns inside that window loses nothing: at a 1-in-3 cadence against a
  //    3-turn bank, throughput is EXACTLY preserved — Washington logs the same
  //    480 plays whether it shows up every turn or every third — and the only
  //    difference left is that capital arrives in lumps, which is a small
  //    ADVANTAGE. Cadences inside the bank therefore measure the bank, not
  //    effort, and read as an inversion where committing more looks worse.
  //    Runs 2 and 3 sit deliberately OUTSIDE it; run 4 sits deliberately inside
  //    it, because "you may skip turns for free" is a property worth proving.
  {
    name: "1. Everyone full effort",
    blurb: "All four seats, every turn, no public. The contested baseline.",
    active: ["US", "UK", "RU", "DD"],
  },
  {
    name: "2. East committed, West distracted",
    blurb:
      "DD/RU every turn; US/UK every sixth — past the AP bank, so the West really does lose actions.",
    active: ["US", "UK", "RU", "DD"],
    effort: { US: 1 / 6, UK: 1 / 6 },
  },
  {
    name: "3. West committed, East distracted",
    blurb: "The mirror: US/UK every turn; DD/RU every sixth.",
    active: ["US", "UK", "RU", "DD"],
    effort: { DD: 1 / 6, RU: 1 / 6 },
  },
  {
    name: "4. Everyone half-hearted",
    blurb:
      "All four seats every other turn — inside the bank, so this should cost nobody anything.",
    active: ["US", "UK", "RU", "DD"],
    effort: { US: 0.5, UK: 0.5, RU: 0.5, DD: 0.5 },
  },
  {
    name: "5. Light seats, real public",
    blurb:
      "All four every third turn, plus 120 characters (10% turnout) at 60% East. " +
      "The case where the street, not the delegations, decides.",
    active: ["US", "UK", "RU", "DD"],
    effort: { US: 1 / 3, UK: 1 / 3, RU: 1 / 3, DD: 1 / 3 },
    personalCount: 120,
    personalEastShare: 0.6,
  },

  // ── Reference: the public at maximum, and the coercive path. ─────────────
  {
    name: "C. Maximum turnout",
    blurb: "1,204 characters at 70% East, all four seats at full effort.",
    active: ["US", "UK", "RU", "DD"],
    personalCount: 1204,
    personalEastShare: 0.7,
  },
  // ── Rebalance candidates. Lifting BOTH Western seats to 2 AP centres the
  //    contested stall at 53 but drops the unopposed lock from 28 turns to 11,
  //    which is too cheap. These try one seat at a time.
  {
    name: "D. Escalation spiral",
    blurb: "Both blocs prefer coercive plays. Measures how hot the ladder runs.",
    active: ["US", "UK", "RU", "DD"],
    coercive: ["US", "RU", "DD"],
  },

  // ── The capital payment route. ────────────────────────────────────────────
  //
  //    These are the ONLY runs where it is exercised. Everywhere else the seats
  //    borrow, because this sim models no consequence of debt and so an in-sim
  //    borrower is strictly better off than one who spends political capital.
  //    Read them against A and B, which are the same seats with the same effort
  //    and the borrowing left on.
  {
    name: "E. Western coalition, debt-averse",
    blurb: "As A, but US and UK buy with political capital rather than borrow.",
    active: ["US", "UK"],
    noBorrow: true,
  },
  {
    name: "F. Eastern coalition, debt-averse",
    blurb: "As B, but the GDR and Moscow buy with political capital rather than borrow.",
    active: ["DD", "RU"],
    noBorrow: true,
  },
];

const pts = (h: number) => (h / HUNDREDTHS).toFixed(1);

console.log("═".repeat(78));
console.log("GERMAN QUESTION — BALANCE SIMULATION");
console.log(`opening index ${pts(3820)}   carry ≥85.0   lock ≤15.0   cap ${MAX_TURNS} turns`);
console.log("═".repeat(78));

// Optional scenario filter: `npx tsx ... A. B.` runs only those. Tuning sweeps
// re-run the bounds dozens of times and do not need the whole set each pass.
const only = process.argv.slice(2);
const selected = only.length
  ? SCENARIOS.filter((s) => only.some((prefix) => s.name.startsWith(prefix)))
  : SCENARIOS;

const results: Result[] = [];
for (const scenario of selected) {
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
    // The ceiling is no longer a constant, so the raw peak alone no longer says
    // whether the cap bit. Print what this turnout actually earned. Plays cycle
    // through the personal catalogue, so roughly two thirds of them land on the
    // street and the rest on the Bundestag — the street's crowd, and therefore
    // its pool, is the larger of the two.
    const streetCrowd = Math.round((scenario.personalCount * 2) / 3);
    console.log(
      `   public: peak raw ${pts(r.personalRawPeak)} on one institution, ` +
        `capped on ${r.personalCappedTurns}/${r.turns} turns` +
        `  (~${streetCrowd} on the street earn a pool of ${pts(personalNetCapFor(streetCrowd))})`
    );
  }
  for (const seat of r.seats) {
    if (!scenario.active.includes(seat.id)) continue;
    const open = OPENING_TREASURY[seat.id];
    const burnTurns = seat.spent > 0 ? (open.amount / (seat.spent / r.turns)).toFixed(0) : "n/a";
    const catalogue = SETTLEMENT_PLAYS.filter((p) => p.seat === seat.id);
    const tally = [...seat.playTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id} x${n}`)
      .join(", ");
    if (tally) console.log(`       ${tally}`);
    const unreachable = catalogue.filter((p) => !seat.playsUsed.has(p.id)).map((p) => p.id);
    console.log(
      `   ${seat.id.padEnd(3)} ${String(seat.playCount).padStart(4)} plays` +
        `  committed ${pts(seat.committed).padStart(7)}` +
        `  capital left ${String(seat.capital).padStart(2)}` +
        `  spend/turn ${(seat.spent / r.turns / 1e6).toFixed(1).padStart(6)}M` +
        `  exhausts ${open.label} in ${burnTurns} turns`
    );
    // The treasury is signed, so a negative close IS the national debt this
    // seat ran up over the game. Nothing brakes it, which is the finding to
    // watch, not a bug.
    const close = seat.treasury;
    const capitalShare =
      seat.playCount > 0 ? Math.round((seat.capitalRouteCount / seat.playCount) * 100) : 0;
    console.log(
      `       closes ${close < 0 ? "IN DEBT " : "in hand "}` +
        `${(Math.abs(close) / 1e6).toFixed(1).padStart(8)}M` +
        `   capital route ${String(seat.capitalRouteCount).padStart(4)}/${seat.playCount} plays (${capitalShare}%)`
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
