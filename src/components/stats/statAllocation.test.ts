import { describe, expect, it } from "vitest";
import { STAT_KEYS, STAT_MIN, STAT_FREE_POINTS } from "@/lib/stats/statsConstants";
import { defaultStatBuild, isLopsided, pointsRemaining, pointsSpent } from "./StatPointAllocator";

describe("defaultStatBuild", () => {
  it("opens with nothing assigned — every stat on the floor", () => {
    const build = defaultStatBuild();
    for (const key of STAT_KEYS) expect(build[key]).toBe(STAT_MIN);
  });

  it("leaves the whole free-point budget to spend", () => {
    expect(pointsSpent(defaultStatBuild())).toBe(0);
    expect(pointsRemaining(defaultStatBuild())).toBe(STAT_FREE_POINTS);
  });
});

describe("isLopsided", () => {
  it("is quiet on the opening build", () => {
    expect(isLopsided(defaultStatBuild())).toBe(false);
  });

  it("is quiet on an even spread", () => {
    const even = STAT_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: 4 }),
      {} as ReturnType<typeof defaultStatBuild>
    );
    expect(isLopsided(even)).toBe(false);
  });

  it("flags a build that dumps several stats to fund one", () => {
    const build = defaultStatBuild();
    build.charisma = 10;
    build.debate = 10;
    build.energy = 4;
    expect(isLopsided(build)).toBe(true);
  });

  it("does not flag a wide spread when only one stat sits on the floor", () => {
    const build = STAT_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: 5 }),
      {} as ReturnType<typeof defaultStatBuild>
    );
    build.charisma = 10;
    build.intellect = STAT_MIN;
    expect(isLopsided(build)).toBe(false);
  });
});
