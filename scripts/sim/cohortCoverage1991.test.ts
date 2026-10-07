import { describe, expect, it } from "vitest";
import {
  evaluateScenario,
  readProvenance,
  type Ages,
  type WorldSnapshot,
} from "./cohortCoverage1991";

/** A region whose adult bands carry an even 25/25/25/25 split. */
function stock(total: number): Ages {
  const male = Array.from({ length: 101 }, () => 0);
  const female = Array.from({ length: 101 }, () => 0);
  const put = (age: number, people: number) => {
    male[age] = people / 2;
    female[age] = people / 2;
  };
  put(10, total * 0.2);
  for (const age of [20, 35, 50, 70]) put(age, total * 0.2);
  return { male, female };
}
const world = (population: number, stocks: Record<string, number> = {}): WorldSnapshot => ({
  regions: new Map([
    ["CEN", { countryId: "RU", statePopulation: population, stock: stock(population) }],
  ]),
  orphanStocks: Object.keys(stocks),
});
const even = () => ({ young: 1, mid: 1, mature: 1, senior: 1 });
const sourceOf = () => ({ source: "WDI_RUS", affected: true });

describe("cohort coverage report checks", () => {
  it("passes a smooth region and flags a stale-stock jump", () => {
    const smooth = evaluateScenario({
      seed: world(30_000_000),
      turns: [world(30_010_000), world(30_020_000)],
      sourceOf,
      expectedAdult: even,
    });
    expect(smooth.failures).toEqual([]);
    expect(smooth.rows[0]).toMatchObject({ id: "CEN", affected: true, source: "WDI_RUS" });

    const jump = evaluateScenario({
      seed: world(30_290_000),
      turns: [world(39_862_013)],
      sourceOf,
      expectedAdult: even,
    });
    expect(jump.failures.join("\n")).toMatch(/CEN: turn 1 moved 31\.6/);
    expect(jump.failures.join("\n")).toMatch(/CEN: drifted/);
  });

  it("flags orphan stocks, missing stocks and a seed that misses its source", () => {
    const missing: WorldSnapshot = {
      regions: new Map([["SU_UKR", { countryId: "RU", statePopulation: 1, stock: null }]]),
      orphanStocks: [],
    };
    expect(
      evaluateScenario({ seed: missing, turns: [], sourceOf, expectedAdult: even }).failures
    ).toEqual(["SU_UKR: populated region has no seeded stock"]);
    const orphan = evaluateScenario({
      seed: world(1000, { RU_RETIRED: 1 }),
      turns: [],
      sourceOf,
      expectedAdult: () => ({ young: 2, mid: 1, mature: 1, senior: 1 }),
    });
    expect(orphan.failures.join("\n")).toMatch(/orphan stocks survive: RU_RETIRED/);
    expect(orphan.failures.join("\n")).toMatch(/miss the source/);
  });

  it("labels a run dirty unless the tree matches a commit that contains the harness", () => {
    const git =
      (porcelain: string, inCommit = true) =>
      (args: string[]) => {
        if (args[0] === "rev-parse") return "a".repeat(40);
        if (args[0] === "merge-base") return "b".repeat(40);
        if (args[0] === "status") return porcelain;
        if (!inCommit) throw new Error("missing");
        return "";
      };
    const read = () => Buffer.from("x");
    const clean = readProvenance(["h.ts"], ["h.ts"], git(""), read);
    expect(clean).toMatchObject({
      sourceState: "clean",
      baseCommit: "b".repeat(40),
      harnessCommit: "a".repeat(40),
    });
    expect(readProvenance(["h.ts"], [], git(" M src/x.ts\n"), read)).toMatchObject({
      sourceState: "dirty",
      dirtyPaths: ["src/x.ts"],
    });
    expect(readProvenance(["h.ts"], [], git("", false), read).sourceState).toBe("dirty");
    // Regenerated report output alone does not make the source dirty.
    expect(
      readProvenance(["h.ts"], [], git("?? scripts/sim/reports/x.md\n"), read).sourceState
    ).toBe("clean");
  });
});
