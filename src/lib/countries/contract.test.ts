import { describe, expect, it } from "vitest";
import { JP } from "./jp";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";

/**
 * Japan satisfies `CountryFolder`, with nothing quietly absent.
 *
 * ⚠️ THE PRE-MOVE FIXTURE IS GONE, DELIBERATELY. Through D2-D6 this file
 * compared every moved registry against `__snapshots__/jp.pre-move.json`, which
 * recorded Japan's values before anything moved. That was the right check while
 * the move was in flight and is the wrong one now: with the move finished, the
 * fixture pins a world that no longer exists, so the first legitimate edit to
 * Japan's data would fail it and the only available fix would be to update the
 * fixture -- at which point it proves nothing at all. A guard that must be
 * rewritten to stay green is worse than no guard, so it was deleted in the same
 * commit rather than left to rot.
 *
 * TWO CHECKS REPLACE IT, and they answer different questions:
 *
 *   - `jp/japanReachable.test.ts` -- is Japan still reachable through the
 *     registries consumers actually use? 51 of 74 moved registries are
 *     `Partial<Record<CountryId, X>>`, so dropping Japan's key is not a type
 *     error and nothing else catches it.
 *   - this file -- is the CONTRACT satisfied? Not whether the values are right,
 *     but whether the shape the plan declared is expressible by a real country.
 *
 * That second question is the one that matters for the other 23 countries. If
 * Japan only fits `CountryFolder` because a member is optional and quietly
 * absent, the shape is wrong and the next country inherits the problem.
 */

/** Members that must be present and non-empty for any country. */
const REQUIRED_MEMBERS = [
  "identity",
  "institutions",
  "elections",
  "economy",
  "geography",
  "eras",
] as const;

describe("Japan satisfies the country contract", () => {
  it("provides every member of CountryFolder", () => {
    expect(JP.id).toBe("JP");
    for (const member of REQUIRED_MEMBERS) {
      expect(JP[member], `JP.${member}`).toBeDefined();
      expect(Object.keys(JP[member]).length, `JP.${member} is empty`).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠️ The point of the exercise. A member satisfied by an empty object, or by a
   * field that happens to be optional, means the contract is not actually being
   * met -- it is being sidestepped. Each assertion below names a field that a
   * country genuinely cannot do without.
   */
  it("fills each member with real content rather than an empty shell", () => {
    expect(JP.identity.displayName).toBe("Japan");
    expect(JP.identity.cabinet.glyph).toBeTruthy();
    expect(JP.identity.addressNames.national).toBeTruthy();

    expect(JP.institutions.config.name).toBe("Japan");
    expect(JP.institutions.legislativeProcess.executive.title).toBeTruthy();
    expect(JP.institutions.cabinet.positions.length).toBeGreaterThan(0);
    expect(Object.keys(JP.institutions.cabinet.orders).length).toBeGreaterThan(0);
    expect(JP.institutions.military.branches.length).toBeGreaterThan(0);

    expect(JP.elections.seats.totals.shugiin).toBe(465);
    expect(JP.elections.seats.totals.sangiin).toBe(248);
    expect(JP.elections.electionPhases?.length).toBe(4);

    expect(JP.economy.currencyCode).toBe("JPY");
    expect(JP.economy.repEcon.gdp).toBeGreaterThan(0);
    expect(Object.keys(JP.economy.sectorWeights.base).length).toBeGreaterThan(0);

    expect(JP.geography.continent).toBe("Asia");
    expect(Object.keys(JP.geography.adjacency)).toHaveLength(8);
    expect(JP.geography.rawMetrics.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ ALL SEVEN shipping presets, not the five an early revision listed. 1999
   * and 2007 were dropped once already, and Japan carries real region, census
   * and demographic data for both.
   */
  it("has an era override for every shipping preset", () => {
    for (const preset of SHIPPING_PRESETS) {
      expect(JP.eras[preset], `no era file for ${preset}`).toBeDefined();
      expect(JP.eras[preset]?.preset, `${preset} mislabelled`).toBe(preset);
    }
    expect(Object.keys(JP.eras)).toHaveLength(SHIPPING_PRESETS.length);
  });

  /**
   * ⚠️ Japan holds config overrides in TWO eras, and 1953 -- the one no test
   * watched before D3 -- carries a full 466/248 legislature. An era table naming
   * only 1991 loses it silently.
   */
  it("keeps both era config overrides intact", () => {
    const y1953 = JP.eras["1953-default"]?.config;
    const y1991 = JP.eras["1991-default"]?.config;
    expect(y1953?.legislature?.lowerChamber?.seats).toBe(466);
    expect(y1953?.legislature?.upperChamber?.seats).toBe(248);
    expect(y1991?.legislature?.lowerChamber?.seats).toBe(512);
    expect(y1991?.legislature?.upperChamber?.seats).toBe(252);
    // The eras that carry no config override must say so by absence, not by an
    // empty object that looks like an override and overrides nothing.
    expect(JP.eras["2019-default"]?.config).toBeUndefined();
  });

  /**
   * Orders of battle start at 1979. The 1953 era has none and must fall back to
   * the base set rather than inventing an empty one.
   */
  it("carries per-era orders of battle only where they exist", () => {
    expect(JP.eras["1953-default"]?.institutions?.military?.ordersOfBattle).toBeUndefined();
    for (const preset of ["1979-default", "1991-default", "2023-default"] as const) {
      const oob = JP.eras[preset]?.institutions?.military?.ordersOfBattle;
      expect(oob, `${preset} orders of battle`).toBeDefined();
      expect(oob?.length).toBeGreaterThan(0);
    }
  });
});
