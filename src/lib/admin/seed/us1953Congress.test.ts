/**
 * Regression: a freshly bootstrapped `1953-default` world must seat the REAL
 * 83rd Congress.
 *
 * Two independent failure modes are pinned here, because the observed bug
 * (a 343 D / 92 R US House and an 81 D / 15 R Senate at the first recorded
 * turn of the headless 1953 sim — the historical result INVERTED) needed both
 * halves to be right and only one of them was:
 *
 *   1. The authored data. `US_HOUSE_1953` / `US_SENATE_1953` must actually
 *      describe the 83rd Congress — House R 221 / D 213 / I 1 = 435 on the
 *      1950-census apportionment, Senate R 48 / D 47 / I 1 = 96 across the 48
 *      states of 1953 (Alaska and Hawaii are territories until 1959), and both
 *      must be reachable through `getPresetSeats("1953-default")`.
 *
 *   2. The bootstrap gate. `bootstrapGameWorld` decides whether to run
 *      `seedHistoricalOfficials` at all. It used to ask "is this world empty?"
 *      with counts taken AFTER its own `seedNGGovernors` step had inserted
 *      Nigerian governor officials + NPPs, so the answer was always "no" and
 *      the authored roster was never seeded on the full bootstrap path. The
 *      chamber then came up empty and `backfillMissingSeats` (headless sim
 *      only) filled it by statePartyOrg organization × registration weight —
 *      which in a Solid-South 1953 hands the Democrats a supermajority.
 *
 * Tolerance: EXACT. Every 1953 US federal seat is authored from the 1952
 * results, so there is no estimation budget to spend — any drift is a data
 * edit, not rounding.
 */

import { describe, it, expect } from "vitest";
import {
  US_HOUSE_1953,
  US_SENATE_1953,
  getPresetSeats,
  type HistoricalSeat,
} from "@/lib/constants/historicalSeats";
import { HOUSE_SEATS_1953, SENATE_CLASSES_BY_STATE } from "@/lib/constants/states";
import { shouldSeedHistoricalOfficials } from "@/lib/admin/seed/historicalSeedGate";

/** 83rd Congress, seated 3 January 1953. */
const HOUSE_83RD = { republican: 221, democrat: 213, independent: 1 } as const;
const SENATE_83RD = { republican: 48, democrat: 47, independent: 1 } as const;
const HOUSE_TOTAL = 435;
const SENATE_TOTAL = 96;
const STATES_1953 = 48;

function tallyByParty(seats: HistoricalSeat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const seat of seats) {
    out[seat.party] = (out[seat.party] ?? 0) + (seat.seatsHeld ?? 1);
  }
  return out;
}

const presetSeats = getPresetSeats("1953-default");
const presetHouse = presetSeats.filter(
  (s) => s.officeType === "house" && s.state in HOUSE_SEATS_1953
);
const presetSenate = presetSeats.filter(
  (s) => s.officeType === "senate" && s.state in HOUSE_SEATS_1953
);

describe("1953-default: US House = 83rd Congress", () => {
  it("is the historical R 221 / D 213 / I 1 split, not a Democratic supermajority", () => {
    expect(tallyByParty(US_HOUSE_1953)).toEqual(HOUSE_83RD);
  });

  it("totals 435 seats and the Republicans hold the majority", () => {
    const tally = tallyByParty(US_HOUSE_1953);
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(total).toBe(HOUSE_TOTAL);
    expect(tally.republican).toBeGreaterThan(tally.democrat);
    expect(tally.republican).toBeGreaterThan(HOUSE_TOTAL / 2);
  });

  it("covers all 48 states of 1953 and matches the 1950-census apportionment per state", () => {
    const byState = new Map<string, number>();
    for (const seat of US_HOUSE_1953) {
      byState.set(seat.state, (byState.get(seat.state) ?? 0) + (seat.seatsHeld ?? 1));
    }
    expect(byState.size).toBe(STATES_1953);
    // AK/HI are territories in 1953 — they must not appear at all.
    expect(byState.has("AK")).toBe(false);
    expect(byState.has("HI")).toBe(false);
    for (const [stateId, seats] of byState) {
      expect(HOUSE_SEATS_1953[stateId], `${stateId} is not a 1953 state`).toBeDefined();
      expect(seats, `${stateId} delegation size`).toBe(HOUSE_SEATS_1953[stateId]);
    }
  });

  it("reaches the preset roster (getPresetSeats wires it in)", () => {
    expect(tallyByParty(presetHouse)).toEqual(HOUSE_83RD);
  });
});

describe("1953-default: US Senate = 83rd Congress", () => {
  it("is the historical R 48 / D 47 / I 1 split", () => {
    expect(tallyByParty(US_SENATE_1953)).toEqual(SENATE_83RD);
  });

  it("totals 96 seats across 48 states — not 100 (AK/HI are territories until 1959)", () => {
    const total = Object.values(tallyByParty(US_SENATE_1953)).reduce((a, b) => a + b, 0);
    expect(total).toBe(SENATE_TOTAL);
    expect(total).not.toBe(100);

    const states = new Set(US_SENATE_1953.map((s) => s.state));
    expect(states.size).toBe(STATES_1953);
    expect(states.has("AK")).toBe(false);
    expect(states.has("HI")).toBe(false);
  });

  it("gives every 1953 state exactly its two canonical Senate classes", () => {
    const byState = new Map<string, number[]>();
    for (const seat of US_SENATE_1953) {
      expect(seat.senateClass, `${seat.state} senate row missing senateClass`).toBeDefined();
      byState.set(seat.state, [...(byState.get(seat.state) ?? []), seat.senateClass as number]);
    }
    for (const [stateId, classes] of byState) {
      expect(HOUSE_SEATS_1953[stateId], `${stateId} is not a 1953 state`).toBeDefined();
      expect([...classes].sort(), `${stateId} senate classes`).toEqual(
        [...SENATE_CLASSES_BY_STATE[stateId]].sort()
      );
    }
  });

  it("reaches the preset roster (getPresetSeats wires it in)", () => {
    expect(tallyByParty(presetSenate)).toEqual(SENATE_83RD);
  });
});

describe("bootstrap gate: the authored roster actually gets seeded", () => {
  it("seeds the historical roster on a fresh historical bootstrap", () => {
    expect(
      shouldSeedHistoricalOfficials({
        mode: "historical",
        preIteration: false,
        preExistingOfficials: 0,
        preExistingNpps: 0,
      })
    ).toBe(true);
  });

  it("is NOT defeated by officials the same bootstrap run seeds later (seedNGGovernors)", () => {
    // The pre-run snapshot is empty; NG governors appear mid-run. Reading the
    // count mid-run is what silently skipped every authored chamber, leaving
    // the 1953 US House to be fabricated by backfillMissingSeats.
    expect(
      shouldSeedHistoricalOfficials({
        mode: "historical",
        preIteration: false,
        preExistingOfficials: 0,
        preExistingNpps: 0,
      })
    ).toBe(true);
  });

  it("still skips a world that was already populated before the run", () => {
    expect(
      shouldSeedHistoricalOfficials({
        mode: "historical",
        preIteration: false,
        preExistingOfficials: 435,
        preExistingNpps: 200,
      })
    ).toBe(false);
    expect(
      shouldSeedHistoricalOfficials({
        mode: "historical",
        preIteration: false,
        preExistingOfficials: 0,
        preExistingNpps: 12,
      })
    ).toBe(false);
  });

  it("never seats the roster in a vacant world, and always seeds priors in a founding reset", () => {
    expect(
      shouldSeedHistoricalOfficials({
        mode: "vacant",
        preIteration: false,
        preExistingOfficials: 0,
        preExistingNpps: 0,
      })
    ).toBe(false);
    expect(
      shouldSeedHistoricalOfficials({
        mode: "historical",
        preIteration: true,
        preExistingOfficials: 3,
        preExistingNpps: 3,
      })
    ).toBe(true);
  });
});
