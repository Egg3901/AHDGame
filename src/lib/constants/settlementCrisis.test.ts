import { describe, expect, it } from "vitest";
import type { SettlementInstitutionId, SettlementSeatId } from "@/lib/db/types/settlementCrisis";
import type { SettlementPlayClass } from "@/lib/db/types/settlementPlay";
import {
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
  SETTLEMENT_PLAYS,
  TOTAL_INSTITUTION_WEIGHT,
  CARRY_THRESHOLD,
  LOCK_THRESHOLD,
  HUNDREDTHS,
  SEAT_ACTION_BANK_TURNS,
  playsForSeat,
  seatActionBankCap,
  type SettlementInstitutionKey,
  type SettlementSeatKey,
  type SettlementPlayDef,
} from "./settlementCrisis";

/**
 * COMPILE-TIME PARITY GUARD.
 *
 * The institution, seat and play-class unions are declared TWICE: once in
 * `src/lib/db/types/settlementCrisis.ts` and once here in constants. They
 * cannot be shared, because a constants file importing `src/lib/db/*` drags
 * `mongodb` into the browser bundle and breaks `next build`.
 *
 * So nothing but this guard stops the two copies from silently diverging — add
 * a fifth institution to one and forget the other, and `institution.id` becomes
 * assignable-but-wrong with every test still green. A test file is not bundled,
 * so it is the one place both sides can be compared.
 *
 * These are type-level assertions: they fail `npm run typecheck`, not vitest.
 */
type Equal<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _InstitutionUnionsMatch = Expect<Equal<SettlementInstitutionKey, SettlementInstitutionId>>;
type _SeatUnionsMatch = Expect<Equal<SettlementSeatKey, SettlementSeatId>>;
type _PlayClassUnionsMatch = Expect<Equal<SettlementPlayDef["class"], SettlementPlayClass>>;

describe("settlement crisis config", () => {
  it("institution weights sum to the declared total", () => {
    const sum = SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.weight, 0);
    expect(sum).toBe(TOTAL_INSTITUTION_WEIGHT);
  });

  it("gives every institution a distinct id", () => {
    const ids = SETTLEMENT_INSTITUTIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every play id distinct from every institution id", () => {
    // A play id colliding with an institution id makes target routing
    // ambiguous — this is why the source design's RU `garrison` play is
    // `pressure` here.
    const institutionIds = new Set<string>(SETTLEMENT_INSTITUTIONS.map((i) => i.id));
    for (const play of SETTLEMENT_PLAYS) {
      expect(institutionIds.has(play.id)).toBe(false);
    }
  });

  it("gives every play a globally distinct id", () => {
    const ids = SETTLEMENT_PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targets every play at a real institution or at the settlement", () => {
    const institutionIds = new Set<string>(SETTLEMENT_INSTITUTIONS.map((i) => i.id));
    for (const play of SETTLEMENT_PLAYS) {
      if (play.target === null) continue; // settlement-level
      expect(institutionIds.has(play.target)).toBe(true);
    }
  });

  it("stores every magnitude unsigned and on the hundredths grid", () => {
    for (const play of SETTLEMENT_PLAYS) {
      expect(play.magnitude).toBeGreaterThan(0);
      expect(Number.isInteger(play.magnitude)).toBe(true);
    }
  });

  it("seeds institutions with anchors West of their opening", () => {
    // The user's balance ruling: Bonn's own politics resist reunification.
    for (const inst of SETTLEMENT_INSTITUTIONS) {
      expect(inst.anchor).toBeLessThan(inst.opening);
    }
  });

  it("puts the weighted anchor at exactly 35 points", () => {
    const weighted =
      SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.anchor * i.weight, 0) /
      TOTAL_INSTITUTION_WEIGHT;
    expect(weighted).toBe(35 * HUNDREDTHS);
  });

  it("puts the weighted opening at 38.2 points", () => {
    const weighted =
      SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.opening * i.weight, 0) /
      TOTAL_INSTITUTION_WEIGHT;
    expect(weighted).toBe(3820);
  });

  it("orders the thresholds sanely", () => {
    expect(LOCK_THRESHOLD).toBeLessThan(CARRY_THRESHOLD);
    expect(LOCK_THRESHOLD).toBe(1500);
    expect(CARRY_THRESHOLD).toBe(8500);
  });

  it("restricts personal plays to the street and the Bundestag", () => {
    for (const play of playsForSeat(null)) {
      expect(["street", "bundestag"]).toContain(play.target);
    }
  });

  it("gives each national seat only its own plays", () => {
    expect(
      playsForSeat("DD")
        .map((p) => p.id)
        .sort()
    ).toEqual(["aid", "border", "referendum", "terms"]);
    expect(
      playsForSeat("UK")
        .map((p) => p.id)
        .sort()
    ).toEqual(["broadcast", "fourpower", "rhine"]);
  });

  it("prices seat plays in the seat country's local currency", () => {
    for (const play of SETTLEMENT_PLAYS.filter((p) => p.seat !== null)) {
      expect(play.fundsUnit, play.id).toBe("local");
    }
  });

  it("prices personal plays in anchor units so every character pays the same value", () => {
    // A flat local cost would make the same play roughly four times cheaper for
    // a Soviet character than an American one at 1953 rates.
    for (const play of SETTLEMENT_PLAYS.filter((p) => p.seat === null)) {
      expect(play.fundsUnit, play.id).toBe("anchor");
    }
  });

  it("gives a funds unit to every play, including the free ones", () => {
    for (const play of SETTLEMENT_PLAYS) {
      expect(["local", "anchor"], play.id).toContain(play.fundsUnit);
    }
  });

  it("grants escalation authority to Washington and Moscow only", () => {
    const authority = SETTLEMENT_SEATS.filter((s) => s.authority)
      .map((s) => s.id)
      .sort();
    expect(authority).toEqual(["RU", "US"]);
  });

  it("keeps every seat play inside its seat's action bank", () => {
    // THE REASON BANKING EXISTS. Four authored plays cost more AP than their
    // seat earns in a turn, Moscow's only garrison lever among them. Without a
    // bank they are unplayable; with one they must still fit inside it, or the
    // catalogue ships a button nobody can ever press.
    for (const seat of SETTLEMENT_SEATS) {
      const bank = seatActionBankCap(seat.actionsPerTurn);
      for (const play of playsForSeat(seat.id)) {
        expect(play.actionCost, `${seat.id}/${play.id}`).toBeLessThanOrEqual(bank);
      }
    }
  });

  it("keeps every personal play inside a single character's turn", () => {
    // Characters have no bank — their AP is the ordinary per-turn pool.
    for (const play of playsForSeat(null)) {
      expect(play.actionCost, play.id).toBeLessThanOrEqual(2);
    }
  });

  it("banks enough turns for the most expensive play on the slowest seat", () => {
    const slowest = Math.min(...SETTLEMENT_SEATS.map((s) => s.actionsPerTurn));
    const dearest = Math.max(...SETTLEMENT_PLAYS.map((p) => p.actionCost));
    expect(SEAT_ACTION_BANK_TURNS * slowest).toBeGreaterThanOrEqual(dearest);
  });

  it("gives both blocs a lever on every institution", () => {
    // The structural check the balance pass turned up: the index is a weighted
    // mean, so an institution one bloc can never touch is a permanent ceiling
    // on how far that bloc can move the whole board. Moscow's garrison play
    // being unaffordable put reunification out of reach entirely.
    const EAST = new Set(["DD", "RU"]);
    for (const institution of SETTLEMENT_INSTITUTIONS) {
      const reach = new Set(
        SETTLEMENT_PLAYS.filter(
          (p) => p.seat !== null && (p.target === institution.id || p.target === null)
        ).map((p) => (EAST.has(p.seat as string) ? "east" : "west"))
      );
      expect([...reach].sort(), institution.id).toEqual(["east", "west"]);
    }
  });
});
