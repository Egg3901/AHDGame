/**
 * The war path: can a bloc actually reach the brink, hold it, and declare?
 *
 * The balance harness (`gq-balance-sim.ts`) never answers this, because nothing
 * it models ever ARMS. Heat accumulates to the coercive cap of 4 and stops —
 * rung 5 is a deliberate press by an authority seat, not something that
 * accumulates — so `armedTurns` reads 0 in every scenario and the whole
 * escalation half of the design goes unmeasured.
 *
 * This drives the SAME shipped modules (`nextHeat`, `defconFor`, `isArmed`,
 * `outcomeFor`) plus the real preconditions the commands enforce:
 *
 *   - `armSettlementLadder` requires heat EXACTLY at MAX_COERCIVE_RUNG, an
 *     authority seat (Washington or Moscow only), and a bloc.
 *   - `declareSettlementWar` requires the ladder still armed at the moment of
 *     the press, and both alliances to have members.
 *   - `levyMobilisation` charges MOBILISATION_TREASURY_SHARE of every seat
 *     country's POSITIVE treasury, plus a flat approval hit, every armed turn,
 *     to all four delegations — not just the two that can arm.
 *
 * The load-bearing detail, and the reason this is worth simulating rather than
 * reasoning about: in `nextHeat` the DECAY branch is tested first, so a turn
 * with no coercive play drops an ARMED ladder from 5 to 4. Holding the brink is
 * not a latch — it needs a coercive play landing every single turn. Whether a
 * bloc can sustain that against its AP, capital and treasury budgets is an
 * arithmetic question nobody had asked.
 *
 * Treasury is drawn down here (unlike the balance harness, which reports burn
 * as a rate) because the mobilisation levy is a share of the balance, so the
 * bill shrinks as the war chest does and a flat rate would misreport it.
 */
import {
  LADDER_DECAY_TURNS,
  LADDER_UNLOCK_TURNS,
  MAX_COERCIVE_RUNG,
  MOBILISATION_APPROVAL_HIT,
  MOBILISATION_TREASURY_SHARE,
  SEAT_CAPITAL_CAP,
  SETTLEMENT_PLAYS,
  SETTLEMENT_SEATS,
  getSeat,
  seatActionBankCap,
  type SettlementPlayDef,
  type SettlementSeatKey,
} from "../../src/lib/constants/settlementCrisis";
import { defconFor, isArmed, nextHeat } from "../../src/lib/settlement/outcome";

/** Opening treasuries and capital banks, matching `gq-balance-sim.ts`. */
const OPENING_TREASURY: Record<SettlementSeatKey, { amount: number; label: string }> = {
  US: { amount: 2_410_000_000, label: "$2.41B" },
  UK: { amount: 480_000_000, label: "£480M" },
  RU: { amount: 1_240_000_000, label: "₽1.24B" },
  DD: { amount: 310_000_000, label: "ℳ310M" },
};
const OPENING_CAPITAL: Record<SettlementSeatKey, number> = { US: 60, UK: 41, RU: 60, DD: 48 };

const MAX_TURNS = 480;

interface SeatSim {
  id: SettlementSeatKey;
  ap: number;
  capital: number;
  treasury: number;
  coerciveCatalogue: SettlementPlayDef[];
}

function makeSeat(id: SettlementSeatKey): SeatSim {
  return {
    id,
    ap: getSeat(id)!.actionsPerTurn,
    capital: OPENING_CAPITAL[id],
    treasury: OPENING_TREASURY[id].amount,
    // Sorted cheapest-first in ACTION points, then capital: a bloc trying to
    // keep the ladder hot wants the play it can afford most often, not the one
    // that moves the index most.
    coerciveCatalogue: SETTLEMENT_PLAYS.filter((p) => p.seat === id && p.addsHeat).sort(
      (a, b) => a.actionCost - b.actionCost || a.capitalCost - b.capitalCost
    ),
  };
}

interface Run {
  bloc: "east" | "west";
  /** Turn the ladder first stood at the coercive cap, ready to arm. */
  readyTurn: number | null;
  /** Turn an authority seat pressed. */
  armedTurn: number | null;
  /** Consecutive armed turns held before the ladder slipped or war was declared. */
  heldTurns: number;
  /** Turn war was declared, if the bloc ever managed it. */
  declaredTurn: number | null;
  /** How many times the ladder fell off rung 5 and had to be rebuilt. */
  slips: number;
  /** Total levied across all four seat countries while armed. */
  levied: Record<SettlementSeatKey, number>;
  approvalLost: number;
  /** Share of turns from `readyTurn` onward that carried a coercive play. */
  coerciveTurns: number;
  turnsAfterReady: number;
  note: string;
}

/**
 * One bloc trying as hard as it can to reach and hold the brink.
 *
 * `holdTurns` is how long the authority seat wants to stand armed before
 * declaring — the design's intent is that the brink is a position you pay to
 * maintain, so a declaration that fires the instant it arms would not test the
 * cost at all.
 */
function run(bloc: "east" | "west", holdTurns: number): Run {
  const seats = (bloc === "east" ? (["DD", "RU"] as const) : (["US", "UK"] as const)).map(makeSeat);
  const authority = seats.find((s) => getSeat(s.id)!.authority);

  const levied: Record<SettlementSeatKey, number> = { US: 0, UK: 0, RU: 0, DD: 0 };
  const treasuries: Record<SettlementSeatKey, number> = {
    US: OPENING_TREASURY.US.amount,
    UK: OPENING_TREASURY.UK.amount,
    RU: OPENING_TREASURY.RU.amount,
    DD: OPENING_TREASURY.DD.amount,
  };

  let heat = 0;
  let readyTurn: number | null = null;
  let armedTurn: number | null = null;
  let declaredTurn: number | null = null;
  let held = 0;
  let bestHeld = 0;
  let slips = 0;
  let approvalLost = 0;
  let coerciveTurns = 0;
  let quietTurns = 0;
  let turnsAfterReady = 0;
  let note = "";

  if (!authority) {
    return {
      bloc,
      readyTurn: null,
      armedTurn: null,
      heldTurns: 0,
      declaredTurn: null,
      slips: 0,
      levied,
      approvalLost: 0,
      coerciveTurns: 0,
      turnsAfterReady: 0,
      note: "no authority seat in this bloc — it can never arm",
    };
  }

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Turn order matters and is easy to get wrong. A player acts DURING a turn
    // and the phase ticks at the end of it, so the ladder an authority seat
    // sees when it presses is the one the PREVIOUS tick wrote. Arming on the
    // same turn the cap is reached would give the bloc a free turn it does not
    // have.

    // ── income ──────────────────────────────────────────────────────────────
    for (const seat of seats) {
      const def = getSeat(seat.id)!;
      seat.ap = Math.min(seat.ap + def.actionsPerTurn, seatActionBankCap(def.actionsPerTurn));
      // The constant, not a literal 60: these agreed by luck, and would have
      // silently disagreed the moment the cap moved.
      seat.capital = Math.min(seat.capital + def.capitalPerTurn, SEAT_CAPITAL_CAP);
      seat.treasury = treasuries[seat.id];
    }

    // ── the authority seat presses, against last tick's ladder ───────────────
    // Gated on the unlock exactly as `armSettlementLadder` gates it: the
    // four-power channel runs first, and the brink is unavailable until it has.
    if (turn >= LADDER_UNLOCK_TURNS && heat === MAX_COERCIVE_RUNG && declaredTurn === null) {
      heat = 5;
      if (armedTurn === null) armedTurn = turn;
    }

    // ── every coercive play the bloc can afford this turn ────────────────────
    let added = 0;
    for (const seat of seats) {
      for (const play of seat.coerciveCatalogue) {
        if (play.actionCost > seat.ap) continue;
        if (play.capitalCost > seat.capital) continue;
        if (play.fundsCost > seat.treasury) continue;
        seat.ap -= play.actionCost;
        seat.capital -= play.capitalCost;
        seat.treasury -= play.fundsCost;
        treasuries[seat.id] = seat.treasury;
        added += 1;
        break; // one coercive play per seat per turn is enough to deny the decay
      }
    }
    if (readyTurn !== null) {
      turnsAfterReady++;
      if (added > 0) coerciveTurns++;
    }

    // ── the standing cost of the brink, on ALL FOUR seat countries ───────────
    if (isArmed(heat)) {
      held++;
      bestHeld = Math.max(bestHeld, held);
      for (const seatDef of SETTLEMENT_SEATS) {
        const id = seatDef.id;
        approvalLost += MOBILISATION_APPROVAL_HIT;
        if (treasuries[id] <= 0) continue;
        const amount = Math.round(treasuries[id] * MOBILISATION_TREASURY_SHARE);
        treasuries[id] -= amount;
        levied[id] += amount;
      }
      // ── declare, once the brink has been held long enough to have cost ─────
      if (held >= holdTurns && declaredTurn === null) {
        declaredTurn = turn;
        note = `declared on turn ${turn}, having held the brink ${held} turn${held === 1 ? "" : "s"}`;
        break;
      }
    }

    // ── the tick: the shipped ladder law, decay branch first ─────────────────
    const before = heat;
    const ladder = nextHeat({ current: heat, added, quietTurns });
    heat = ladder.heat;
    quietTurns = ladder.quietTurns;
    if (before >= 5 && heat < 5) {
      // A turn with no coercive play knocks an ARMED ladder back to 4.
      slips++;
      bestHeld = Math.max(bestHeld, held);
      held = 0;
    }
    if (heat === MAX_COERCIVE_RUNG && readyTurn === null) readyTurn = turn;
  }

  if (declaredTurn === null) {
    note =
      armedTurn === null
        ? readyTurn === null
          ? "never reached the coercive cap"
          : `reached the cap on turn ${readyTurn} but never armed`
        : `armed on turn ${armedTurn} but could not hold ${holdTurns} turns (best ${bestHeld}, ${slips} slips)`;
  }

  return {
    bloc,
    readyTurn,
    armedTurn,
    heldTurns: bestHeld,
    declaredTurn,
    slips,
    levied,
    approvalLost,
    coerciveTurns,
    turnsAfterReady,
    note,
  };
}

// ── report ────────────────────────────────────────────────────────────────────
const money = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`);

console.log("═".repeat(78));
console.log("GERMAN QUESTION — WAR PATH SIMULATION");
console.log(
  `coercive cap rung ${MAX_COERCIVE_RUNG} · armed rung 5 · ` +
    `levy ${(MOBILISATION_TREASURY_SHARE * 100).toFixed(0)}% of treasury + ` +
    `${MOBILISATION_APPROVAL_HIT} approval per armed turn, all four seats`
);
console.log(
  `ladder unlocks on turn ${LADDER_UNLOCK_TURNS} · ` +
    `the ladder loses a rung every ${LADDER_DECAY_TURNS} quiet turns`
);
console.log("═".repeat(78));

console.log("\nWho can even press the button:");
for (const seat of SETTLEMENT_SEATS) {
  const coercive = SETTLEMENT_PLAYS.filter((p) => p.seat === seat.id && p.addsHeat);
  const def = getSeat(seat.id)!;
  const cheapest = [...coercive].sort((a, b) => a.capitalCost - b.capitalCost)[0];
  // Capital is the binding constraint on repeat coercion, not action points.
  const everyNTurns = cheapest
    ? Math.max(
        cheapest.capitalCost / def.capitalPerTurn,
        cheapest.actionCost / def.actionsPerTurn
      ).toFixed(1)
    : "—";
  console.log(
    `  ${seat.id}  ${def.authority ? "AUTHORITY" : "         "}  ` +
      `${coercive.length} coercive play${coercive.length === 1 ? " " : "s"}  ` +
      `${cheapest ? `cheapest ${cheapest.id} (${cheapest.actionCost} AP, ${cheapest.capitalCost} cap)` : "none"}` +
      `${cheapest ? ` — sustainable every ${everyNTurns} turns` : ""}`
  );
}

for (const holdTurns of [1, 6, 12, 24]) {
  console.log(`\n${"─".repeat(78)}`);
  console.log(`Intent: arm, hold ${holdTurns} turn${holdTurns === 1 ? "" : "s"}, then declare`);
  for (const bloc of ["east", "west"] as const) {
    const r = run(bloc, holdTurns);
    const label = bloc === "east" ? "EAST (Moscow + East Berlin)" : "WEST (Washington + London)";
    console.log(`\n  ${label}`);
    console.log(`    ${r.note}`);
    if (r.readyTurn !== null) {
      const density = r.turnsAfterReady
        ? ((r.coerciveTurns / r.turnsAfterReady) * 100).toFixed(0)
        : "0";
      console.log(
        `    reached rung ${MAX_COERCIVE_RUNG} on turn ${r.readyTurn}; ` +
          `landed a coercive play on ${density}% of turns after that`
      );
    }
    if (r.armedTurn !== null) {
      console.log(
        `    DEFCON ${defconFor(5)} for ${r.heldTurns} consecutive turns, ${r.slips} slip${r.slips === 1 ? "" : "s"} off the brink`
      );
      const total = Object.values(r.levied).reduce((a, b) => a + b, 0);
      const bill = SETTLEMENT_SEATS.map(
        (s) =>
          `${s.id} ${money(r.levied[s.id])} (${((r.levied[s.id] / OPENING_TREASURY[s.id].amount) * 100).toFixed(0)}%)`
      ).join("  ");
      console.log(`    mobilisation bill: ${bill}`);
      console.log(
        `    ${money(total)} across four treasuries, ${r.approvalLost} approval points burned`
      );
    }
  }
}

console.log(`\n${"═".repeat(78)}`);
