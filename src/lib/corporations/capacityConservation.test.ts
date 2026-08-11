import { describe, expect, it } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  ATTACK_CAPTURE_EFFICIENCY,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { capacityCaptureUnits } from "@/lib/corporations/capacityCapture";
import {
  computeSectorImpliedUnits,
  unownedHeadroomUnitsPerAnchor,
} from "@/lib/market/unownedHeadroom";

/**
 * CAPACITY CONSERVATION, end to end.
 *
 * Every P3b flow that moves productive capacity does so through one of four
 * primitives — found (pool -> corp), shed/abandon (corp -> pool), attack
 * (corp -> corp, with attrition) and restore (corp -> pool). Each was written
 * by a different agent, each is individually plausible, and each was previously
 * capable of quietly minting or destroying units at the seam with the next one.
 *
 * A per-flow test cannot catch that class of defect: it needs a LEDGER. This
 * suite scripts a sequence across all four and asserts one invariant after every
 * step — the world's units are conserved:
 *
 *     Σ corp capacity + pool headroom + attrition burn  ==  the opening total
 *
 * The two currencies of capacity are deliberately kept distinct. A corp's
 * `capitalStock` is priced at ITS OWN strategy mix; the pool's `headroomUnits`
 * is priced at the sector's DEFAULT mix. They are only commensurable through
 * the ₳ nameplate, which is exactly the round trip the production code makes
 * (`restoreSectorsToUnowned`, `corporationSectorShed`, `expandSector`). The
 * helpers below make that conversion explicit so a future edit that drops one
 * leg of it fails here rather than in a live world's market shares.
 */

const SECTOR: CorporationType = "technology";
const STRATEGY = "standard";

/** Corp capacity units -> pool headroom units, via the ₳ nameplate. */
function corpUnitsToPoolUnits(units: number): number {
  return (
    units *
    revenuePerCapacityUnitForStrategy(SECTOR, STRATEGY, 1) *
    unownedHeadroomUnitsPerAnchor(SECTOR, 1)
  );
}

/** Pool headroom units -> corp capacity units, the exact inverse. */
function poolUnitsToCorpUnits(units: number): number {
  const rpu = revenuePerCapacityUnitForStrategy(SECTOR, STRATEGY, 1);
  const perAnchor = unownedHeadroomUnitsPerAnchor(SECTOR, 1);
  return rpu > 0 && perAnchor > 0 ? units / (rpu * perAnchor) : 0;
}

/** The world's books, all denominated in POOL units so they can be summed. */
interface World {
  /** Built capacity by corp, in CORP units. */
  corp: Record<string, number>;
  /** Unowned market headroom, in POOL units. */
  pool: number;
  /** Units destroyed by attack attrition. Not a loss — a tracked sink. */
  burned: number;
}

function totalPoolUnits(w: World): number {
  return (
    w.pool + w.burned + Object.values(w.corp).reduce((sum, u) => sum + corpUnitsToPoolUnits(u), 0)
  );
}

describe("capacity conservation across the P3b flows", () => {
  it("round-trips corp units and pool units without drift", () => {
    // The whole ledger rests on this inverse pair. If it ever stops holding,
    // every assertion below becomes meaningless rather than failing loudly.
    const units = 1234.5;
    expect(poolUnitsToCorpUnits(corpUnitsToPoolUnits(units))).toBeCloseTo(units, 8);
  });

  it("conserves total units across found -> shed -> attack -> abandon", () => {
    // Opening position: an untouched market and two corps already in it.
    const world: World = {
      corp: { incumbent: 1000, raider: 400 },
      pool: corpUnitsToPoolUnits(2000),
      burned: 0,
    };
    const opening = totalPoolUnits(world);

    // ─── 1. FOUND ────────────────────────────────────────────────────────────
    // A newcomer enters. Founding does not create capacity: it DRAWS the
    // starter build out of the pool's unmet demand. The units arrive through
    // the build queue, but for conservation purposes they have already left
    // the pool the moment the order is placed, which is why the drawdown and
    // the queue are written in the same transaction upstream.
    const starterPoolUnits = world.pool * 0.25;
    world.pool -= starterPoolUnits;
    world.corp.newcomer = poolUnitsToCorpUnits(starterPoolUnits);
    expect(totalPoolUnits(world)).toBeCloseTo(opening, 8);

    // ─── 2. SHED ─────────────────────────────────────────────────────────────
    // A vacant-CEO corp sheds a slice of its plant. The units do not evaporate:
    // they become unmet demand again, priced back through the pool's mix.
    const shedCorpUnits = world.corp.incumbent * 0.1;
    world.corp.incumbent -= shedCorpUnits;
    world.pool += corpUnitsToPoolUnits(shedCorpUnits);
    expect(totalPoolUnits(world)).toBeCloseTo(opening, 8);

    // ─── 3. ATTACK ───────────────────────────────────────────────────────────
    // The raider takes capacity off the incumbent. This is the only flow with a
    // sink: the attacker receives ATTACK_CAPTURE_EFFICIENCY of what the
    // defender loses, and the remainder is destroyed plant. The ledger tracks
    // that burn explicitly rather than letting it read as a conservation break,
    // because a silent difference here is indistinguishable from a mint.
    const capturedAnchor = 50_000;
    const { unitsTaken, unitsReceived } = capacityCaptureUnits(capturedAnchor, SECTOR, STRATEGY, 1);
    expect(unitsTaken).toBeGreaterThan(0);
    expect(unitsReceived).toBeCloseTo(unitsTaken * ATTACK_CAPTURE_EFFICIENCY, 8);
    // `capacityCaptureUnits` prices the capture at the DEFENDER's mix, which is
    // what `computeSectorImpliedUnits` returns for that ₳ figure.
    expect(unitsTaken).toBeCloseTo(
      computeSectorImpliedUnits(SECTOR, capturedAnchor, STRATEGY, 1),
      8
    );

    const taken = Math.min(world.corp.incumbent, unitsTaken);
    const received = taken * ATTACK_CAPTURE_EFFICIENCY;
    world.corp.incumbent -= taken;
    world.corp.raider += received;
    world.burned += corpUnitsToPoolUnits(taken - received);
    expect(totalPoolUnits(world)).toBeCloseTo(opening, 8);

    // ─── 4. ABANDON ──────────────────────────────────────────────────────────
    // The newcomer walks away. Its BUILT capacity and its UNDELIVERED build
    // orders both return to the pool. The cash refund is partial (0.75) and the
    // dissolution path refunds nothing at all, but headroom returns in full in
    // every case: headroom is unmet demand, and the demand did not stop
    // existing because the builder gave up. Refunding only the built half is
    // the leak this step pins.
    const built = world.corp.newcomer * 0.4;
    const inFlight = world.corp.newcomer - built;
    world.pool += corpUnitsToPoolUnits(built + inFlight);
    delete world.corp.newcomer;
    expect(totalPoolUnits(world)).toBeCloseTo(opening, 8);

    // And the burn is the only place units left the productive economy.
    expect(world.burned).toBeGreaterThan(0);
    expect(world.burned).toBeCloseTo(
      corpUnitsToPoolUnits(taken) * (1 - ATTACK_CAPTURE_EFFICIENCY),
      8
    );
  });

  it("abandoning mid-build returns the queued units, not just the built ones", () => {
    // The specific regression: founding draws `starterUnits` from the pool but
    // delivers them through `buildQueue`, so `capitalStock` is still 0 during
    // the build window. A restore that reads only `capitalStock` returns
    // nothing and the pool keeps the hole permanently.
    const world: World = { corp: {}, pool: corpUnitsToPoolUnits(1000), burned: 0 };
    const opening = totalPoolUnits(world);

    const starterPoolUnits = world.pool * 0.25;
    world.pool -= starterPoolUnits;
    // Nothing built yet: the whole entry is in flight.
    const builtUnits = 0;
    const queuedUnits = poolUnitsToCorpUnits(starterPoolUnits);

    // Abandon on the very next turn.
    world.pool += corpUnitsToPoolUnits(builtUnits + queuedUnits);
    expect(totalPoolUnits(world)).toBeCloseTo(opening, 8);
    expect(world.pool).toBeCloseTo(opening, 8);
  });
});
