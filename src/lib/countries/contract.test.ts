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
    // Optional on the contract: CABINET_IDENTITY covers 9 of 29 countries.
    expect(JP.identity.cabinet?.glyph).toBeTruthy();
    // Optional on the contract since China omits it, but Japan HAS one, and the
    // point of this file is that a country's own fields are really filled.
    expect(JP.identity.addressNames?.national).toBeTruthy();

    expect(JP.institutions.config.name).toBe("Japan");
    // Optional on the contract since Russia has no row; Japan HAS one.
    expect(JP.institutions.legislativeProcess?.executive.title).toBeTruthy();
    // Optional on the contract: Brazil's cabinet is the shared economy-tier set.
    expect(JP.institutions.cabinet.positions?.length).toBeGreaterThan(0);
    expect(Object.keys(JP.institutions.cabinet.orders ?? {}).length).toBeGreaterThan(0);
    expect(JP.institutions.military.branches.length).toBeGreaterThan(0);

    // Optional on the contract since East Germany apportions from live regions.
    expect(JP.elections.seats?.totals.shugiin).toBe(465);
    expect(JP.elections.seats?.totals.sangiin).toBe(248);
    expect(JP.elections.electionPhases?.length).toBe(4);

    expect(JP.economy.currencyCode).toBe("JPY");
    expect(JP.economy.repEcon?.gdp).toBeGreaterThan(0);
    expect(Object.keys(JP.economy.sectorWeights.base).length).toBeGreaterThan(0);

    expect(JP.geography.continent).toBe("Asia");
    expect(Object.keys(JP.geography.adjacency)).toHaveLength(8);
    expect(JP.geography.rawMetrics.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ THREE IDENTITY FIELDS BECAME OPTIONAL WHEN THE CONTRACT MET ITS FIRST
   * PRESIDENTIAL COUNTRY, AND THIS IS WHAT STOPS THAT BEING SLACK.
   *
   * `parliamentarySurface`, `regionCensusLabels` and `stateDisplayNames` were
   * required, because the contract was written against a sample of one: Japan,
   * which is parliamentary and is nobody's default. The US is presidential, so
   * it has no parliamentary executive to give a surface to, and it IS the
   * default country, so `REGION_CENSUS_LABELS` and `STATE_DISPLAY_NAMES` have no
   * US key on purpose -- unlisted countries take the generic labels and
   * `compactRegionCode`.
   *
   * Making them optional and stopping there would let a parliamentary country
   * drop its surface silently, which is precisely the class of failure this file
   * exists to catch. So the requirement is not removed, it is narrowed: it now
   * depends on `config.governmentType`, which is the field that actually decides
   * whether the value should exist. The header on this file says a member that
   * is "optional and quietly absent" means the shape is wrong; a member that is
   * conditionally required by a discriminant does not have that problem.
   */
  it("requires the parliamentary surface of parliamentary countries only", () => {
    const parliamentary = JP.institutions.config.governmentType !== "presidential";
    expect(parliamentary, "JP should not be presidential").toBe(true);
    expect(
      JP.identity.parliamentarySurface,
      "a parliamentary country needs a surface"
    ).toBeDefined();
    // `executiveTitle`, not `title`: the surface names the head of government
    // ("Prime Minister"), and its nested plaques carry the `title` fields.
    expect(JP.identity.parliamentarySurface?.executiveTitle).toBeTruthy();
    expect(JP.identity.parliamentarySurface?.headPlaque.title).toBeTruthy();
  });

  /**
   * ⚠️ EVERY shipping preset, counted from SHIPPING_PRESETS rather than a
   * literal. An early revision listed five and dropped 1999 and 2007, for which
   * Japan carries real region, census and demographic data; upstream then added
   * 2027, taking it to eight. A hard-coded count would have to be chased each
   * time, which is the failure this assertion exists to prevent.
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
