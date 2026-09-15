import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MOVED_REGISTRIES, MOVED_THUNK_REGISTRIES } from "./movedRegistries";

/**
 * The move must change nothing. Each entry pins one registry's pre-move value
 * against the folder that replaces it.
 *
 * ⚠️ `before` MUST read the committed snapshot, never the live registry. Once a
 * registry forwards to the folder, reading it back compares the new thing to
 * itself. That tautology is not hypothetical: it happened in Plan C task C0,
 * where rewiring `getPresetSeats` made its faithful-replacement test vacuous
 * until it was rebuilt against the raw source arrays.
 *
 * D1 ships both tables empty; D2 onward fill them. The fixture tests below are
 * what make this file worth running today.
 */

const SNAPSHOT = "src/lib/countries/__snapshots__/jp.pre-move.json";

interface SnapshotEntry {
  shape: string;
  value: unknown;
  functionKeys?: string[];
}

const snapshot = (): Record<string, SnapshotEntry> =>
  JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, SnapshotEntry>;

describe("pre-move snapshot", () => {
  it("exists and covers every registry Japan's folder will absorb", () => {
    const entries = Object.entries(snapshot());
    // 79 registries, emitted before anything moved. If this drops, the fixture
    // was regenerated after a rewire and no longer records pre-move values.
    expect(entries.length).toBe(79);
  });

  /**
   * ⚠️ THE EMITTER NOW READS ONLY 78. The fixture holds 79 and that difference
   * is deliberate.
   *
   * POPULATION_MULTIPLIERS cannot be exported. Seven country seeders destructure
   * `applyEra1991DemographicAdjustments` out of a ternary that unions the WHOLE
   * module type with a stub object:
   *
   *   const { applyEra1991DemographicAdjustments } = is1991
   *     ? await import(".../stateDemographics1991")
   *     : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };
   *
   * Adding any export changes the module shape, the union call stops resolving,
   * and the seeded value becomes `unknown` -- 19 errors across
   * seedBR/CN/DE/IE/JP/NG/UK. The value below was captured on the initial run
   * while the export was briefly in place, which is why the fixture has it and
   * a re-run of the emitter would not.
   *
   * D5 owns POPULATION_MULTIPLIERS. It must either fix that seeder pattern
   * first or move the registry without exporting it in place.
   */
  it("keeps the pre-move value of the registry that cannot be exported", () => {
    const entry = snapshot().POPULATION_MULTIPLIERS;
    expect(entry.shape).toBe("country-first");
    // Japan's 1991 cohort multipliers, eight groups.
    expect(Object.keys(entry.value as object).sort()).toEqual([
      "komeito_faithful",
      "reform_populist",
      "retiree",
      "rural_traditionalist",
      "salaryman_conservative",
      "urban_progressive",
      "working_mothers",
      "young_urban",
    ]);
  });

  /**
   * "absent" means the extractor found no Japan anywhere in the registry. That
   * is either a registry Japan genuinely has no entry in -- which the plan must
   * state deliberately, as it does for ERA_COUNTRY_NAMES -- or a shape the
   * extractor does not understand. The second kind is silent data loss, so it
   * fails here rather than surfacing as an empty era file three phases later.
   */
  it("found Japan in every registry it recorded", () => {
    const absent = Object.entries(snapshot())
      .filter(([, e]) => e.shape === "absent")
      .map(([name]) => name);
    expect(absent, "extractor found no Japan in these; verify each by hand").toEqual([]);
  });

  /**
   * Japan does not sit at the same depth everywhere. Recording the shape makes
   * the awkward ones visible instead of leaving them to be rediscovered:
   * CORE5_NORMALS is metric-first with a `global` sibling that must not move,
   * ERA_COUNTRY_CONFIG_OVERRIDES is preset-first and holds Japan in TWO eras,
   * and ISO_NUMERIC_TO_COUNTRY keys by ISO code with JP as the value.
   */
  it("records a known shape for every entry", () => {
    const known = new Set([
      "country-first",
      "nested-under-country",
      "outer-keyed",
      "composite-key",
      "function-valued",
      "whole-registry",
      "value-keyed",
    ]);
    const odd = Object.entries(snapshot())
      .filter(([, e]) => !known.has(e.shape))
      .map(([name, e]) => `${name} -> ${e.shape}`);
    expect(odd).toEqual([]);
  });

  /**
   * The plan warned that an executor writing eras/1953.ts from a table naming
   * only 1991 would silently drop Japan's 1953 override -- which carries a full
   * 466/248 legislature. Pin both eras so the fixture cannot lose one.
   */
  it("keeps both of Japan's era config overrides", () => {
    const eras = snapshot().ERA_COUNTRY_CONFIG_OVERRIDES;
    expect(Object.keys(eras.value as object).sort()).toEqual(["1953-default", "1991-default"]);
    const y1953 = (eras.value as Record<string, Record<string, unknown>>)["1953-default"];
    expect(Object.keys(y1953).sort()).toEqual([
      "coalitionThreshold",
      "legislature",
      "majorPartyIds",
      "usdExchangeRate",
    ]);
  });

  /**
   * Rev 8 counted five orders-of-battle eras and a `| head -5` grep hid two more.
   */
  it("keeps all six orders-of-battle eras", () => {
    const value = snapshot().ORDERS_OF_BATTLE_BY_ERA.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["1979", "1991", "1999", "2007", "2019", "2023"]);
  });

  /**
   * ⚠️ toEqual compares functions by REFERENCE, so the faithful-replacement
   * harness is blind to these. They are listed here so the blindness is on the
   * record, and D3/D5 must pin them by resolved BEHAVIOUR via
   * MOVED_THUNK_REGISTRIES instead.
   */
  it("names every function-valued registry the harness cannot compare", () => {
    const fnValued = Object.entries(snapshot())
      .filter(([, e]) => e.shape === "function-valued")
      .map(([name]) => name)
      .sort();
    expect(fnValued).toEqual(["COUNTRY_BILL_PHASES", "REGION_ROSTERS", "SPAWN_ELECTIONS_REGISTRY"]);
    // All seven shipping presets, not the five an earlier revision listed.
    expect(snapshot().REGION_ROSTERS.functionKeys).toEqual([
      "1953",
      "1979",
      "1991",
      "1999",
      "2007",
      "2019",
      "2023",
    ]);
  });
});

describe("faithful replacement", () => {
  if (MOVED_REGISTRIES.length === 0) {
    it("has no moved registries yet", () => {
      expect(MOVED_REGISTRIES).toEqual([]);
    });
  } else {
    /**
     * The whole point of the phase. `after()` reads the live registry, which now
     * forwards to Japan's folder; the expected value comes from the committed
     * pre-move fixture, never from the registry itself. Comparing the registry
     * to the registry would pass vacuously no matter what the move broke.
     */
    it.each(MOVED_REGISTRIES)("$name is unchanged by the move", ({ name, after }) => {
      const entry = snapshot()[name];
      expect(entry, `${name} is not in the pre-move fixture`).toBeDefined();
      expect(after()).toEqual(entry.value);
    });

    it("forwards every registry the fixture recorded for this phase", () => {
      // Guards the other direction: a registry quietly dropped from the table
      // would otherwise just stop being checked.
      expect(MOVED_REGISTRIES.length).toBe(15);
      const missing = MOVED_REGISTRIES.filter((r) => !snapshot()[r.name]);
      expect(missing.map((r) => r.name)).toEqual([]);
    });
  }

  if (MOVED_THUNK_REGISTRIES.length === 0) {
    it("has no moved thunk registries yet", () => {
      expect(MOVED_THUNK_REGISTRIES).toEqual([]);
    });
  } else {
    it.each(MOVED_THUNK_REGISTRIES)(
      "$name resolves to the same values after the move",
      async ({ paths, resolved }) => {
        const snapshotted = await resolved();
        // Pin the key set too: a silently dropped era would otherwise compare
        // an empty intersection and pass.
        expect(paths().map((p) => p.join("."))).toEqual(Object.keys(snapshotted));
      }
    );
  }
});
