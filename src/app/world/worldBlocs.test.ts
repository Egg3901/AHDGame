import { describe, expect, it } from "vitest";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { resolveSeedRoster } from "@/lib/internationalOrganizations/founding";
import {
  BLOC_COLORS,
  BLOC_LABELS,
  BLOC_ORDER,
  buildBlocLookup,
  hasBlocData,
  type WorldBloc,
} from "./worldBlocs";

/**
 * The globe draws a country as interactive when the era's manifest gives it a
 * real simulation tier. Those are exactly the countries bloc mode must be able
 * to color — anything else stays Background dark grey by design.
 */
function interactiveFeatureIds1953(): string[] {
  const snapshot = getWorldEntityMapSnapshot("1953-default");
  return Object.entries(snapshot.byFeatureId)
    .filter(
      ([, item]) =>
        item.simulationTier === "full-autonomous" || item.simulationTier === "sphere-macro"
    )
    .map(([featureId]) => featureId);
}

/** The 1953 roll, as `loadBlocMembership` would return it from the database. */
function membership1953(): Record<string, WorldBloc> {
  const out: Record<string, WorldBloc> = {};
  for (const id of resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.NATO, "1953-default")) {
    out[String(id)] = "west";
  }
  for (const id of resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT, "1953-default")) {
    out[String(id)] = "east";
  }
  return out;
}

const lookup1953 = () =>
  buildBlocLookup({
    presetId: "1953-default",
    membership: membership1953(),
    interactiveFeatureIds: interactiveFeatureIds1953(),
  });

describe("worldBlocs", () => {
  it("colors every interactive country, so none renders as a hole", () => {
    const lookup = lookup1953();
    const missing = interactiveFeatureIds1953().filter((id) => !lookup.get(id));
    expect(missing).toEqual([]);
  });

  it("paints the two alliances at their real size, and nothing else", () => {
    // The treaty, not the sympathy. The hand-written table this replaced had
    // Spain and Brazil blue without NATO membership, West Germany blue two years
    // before it joined, and China red having never been in the Warsaw Pact.
    const lookup = lookup1953();
    expect(lookup.get("250")).toBe("west"); // FR — NATO
    expect(lookup.get("300")).toBe("west"); // GR — NATO since 1952
    expect(lookup.get("616")).toBe("east"); // PL — Warsaw Pact
    for (const [iso, name] of [
      ["156", "CN"],
      ["276", "DE"],
      ["724", "ES"],
      ["076", "BR"],
      ["392", "JP"],
      ["408", "KP"],
    ] as const) {
      expect(lookup.get(iso), name).toBe("nonAligned");
    }
  });

  it("paints a member whatever its tier", () => {
    // NATO seats Canada, the Benelux, Norway, Denmark, Portugal and Iceland as
    // background entities. An alliance that does not draw its own members is
    // not drawing the alliance.
    const lookup = lookup1953();
    for (const iso of ["124", "528", "056", "442", "578", "208", "620", "352"]) {
      expect(lookup.get(iso), iso).toBe("west");
    }
  });

  it("keys region-overlay blobs so an overlaid nation matches its base polygon", () => {
    const lookup = lookup1953();
    // The soviet-union shard draws the USSR as a bi: blob over feature 643.
    expect(lookup.get("643")).toBe("east");
    expect(lookup.get("bi:RU")).toBe("east");
    // East Germany has no feature id of its own — blob only, and this is what
    // puts it on the map at all.
    expect(lookup.get("bi:DD")).toBe("east");
    expect(lookup.get("bi:UK")).toBe("west");
  });

  it("paints USSR republic dependents East with their metropole, not non-aligned", () => {
    // UKR/BLR/BAL are full-autonomous dependents of RU in 1953 with their own
    // ISO polygons. Treaty membership alone leaves them non-aligned sand inside
    // the Soviet mass; they must inherit RU's Warsaw Pact colour.
    const lookup = lookup1953();
    expect(lookup.get("804")).toBe("east"); // UKR
    expect(lookup.get("112")).toBe("east"); // BLR
    expect(lookup.get("440")).toBe("east"); // LT (BAL)
    expect(lookup.get("428")).toBe("east"); // LV (BAL)
    expect(lookup.get("233")).toBe("east"); // EE (BAL)
    expect(lookup.get("bi:UKR")).toBe("east");
    expect(lookup.get("bi:BAL")).toBe("east");
    expect(lookup.get("bi:BLR")).toBe("east");
  });

  it("offers the mode only where blocs exist, and returns nothing elsewhere", () => {
    expect(hasBlocData("1953-default")).toBe(true);
    expect(hasBlocData("1979-default")).toBe(true);
    expect(hasBlocData("2019-default")).toBe(false);
    expect(hasBlocData(undefined)).toBe(false);
    expect(
      buildBlocLookup({
        presetId: "2019-default",
        membership: membership1953(),
        interactiveFeatureIds: interactiveFeatureIds1953(),
      }).size
    ).toBe(0);
  });

  it("splits 1953 across all three blocs rather than collapsing to two", () => {
    const counts = new Map<WorldBloc, number>();
    for (const bloc of lookup1953().values()) counts.set(bloc, (counts.get(bloc) ?? 0) + 1);
    for (const bloc of BLOC_ORDER) {
      expect(counts.get(bloc) ?? 0, bloc).toBeGreaterThan(0);
      expect(BLOC_LABELS[bloc]).toBeTruthy();
      expect(BLOC_COLORS[bloc]).toBeTruthy();
    }
  });
});
