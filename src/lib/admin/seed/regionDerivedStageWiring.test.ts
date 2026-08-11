/**
 * Contract test for WHERE the region-derived seeders run.
 *
 * `runRegionDerivedStage` owns the eight seeders that read `states` for their
 * roster (resource capacity, sector specializations, political metrics,
 * military units, national manpower, cabinet estates, energy plants, infra
 * projects). It must run exactly once per bootstrap, after every country has
 * its regions.
 *
 * `runSeed` seeds only the US states bundle, so running the stage from inside
 * it covers the US and nothing else. `runSeed` therefore takes
 * `includeRegionDerived`, defaulting true for the standalone callers
 * (`POST /api/seed`, `scripts/seed/seed.ts`), and `seedAllCountryData` is required
 * to pass false.
 *
 * This is asserted against source text rather than by driving the functions:
 * `seedAllCountryData` calls ~100 seeders and `runSeed` reaches `getDb()`
 * through several helpers, so neither runs without a live database — the same
 * reason `runCoreSeedReset.test.ts` pins its constant instead.
 *
 * The regression this exists for is specific and already happened once: the
 * flag was added, documented as "seedAllCountryData passes FALSE", and then
 * never actually passed. Nothing failed. The stage simply ran twice on every
 * bootstrap and reset — visible only as a repeated log line in an op profile.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src", "lib", "admin");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

describe("region-derived stage wiring", () => {
  it("seedAllCountryData opts out of runSeed's region-derived stage", () => {
    const source = read("bootstrapGameWorld.ts");
    const call = source.match(/await runSeed\(\{[^}]*\}\)/);
    expect(call, "seedAllCountryData no longer calls runSeed").not.toBeNull();
    expect(call![0]).toContain("includeRegionDerived: false");
  });

  it("bootstrap runs the stage itself, once", () => {
    const source = read("bootstrapGameWorld.ts");
    const calls = source.match(/runRegionDerivedStage\(db, \{/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("runSeed still runs the stage by default, for the standalone callers", () => {
    // POST /api/seed and scripts/seed/seed.ts pass no flag and must keep seeding the
    // region-derived collections for the US bundle they do own.
    const source = read("seed/runCoreSeed.ts");
    expect(source).toContain("includeRegionDerived = true");
  });

  it("political metrics are seeded only from the stage", () => {
    // Seeding them inside runSeed's core covered the US alone, and the stage
    // then re-seeded every country's rows — three passes per reset in total.
    const source = read("seed/runCoreSeed.ts");
    const calls = source.match(/await seedPoliticalMetrics\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const stageIndex = source.indexOf("export async function runRegionDerivedStage");
    expect(stageIndex).toBeGreaterThan(-1);
    expect(source.indexOf("await seedPoliticalMetrics(")).toBeGreaterThan(stageIndex);
  });
});
