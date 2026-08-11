import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { portraitsForYear, selectPoliticianImage } from "./generator";

/**
 * Portrait era tiers.
 *
 * NPP portraits were year-blind, so a 1953 politician could draw a 2010s press
 * photo. The year is parsed out of each Commons URL — about a third of the pool
 * carries one, and that third is overwhelmingly modern, which is exactly the set
 * that wrecks a historical world.
 */

interface Row {
  id: string;
  name: string;
  country: string;
  url: string;
}

const POOL: Row[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "src", "data", "npp-politician-images.json"), "utf-8")
);

function yearOf(url: string): number | null {
  const m = /(1[89]\d\d|20[0-2]\d)/.exec(url);
  return m ? Number(m[1]) : null;
}

describe("portrait era filtering", () => {
  it("the pool really does carry datable URLs, skewed modern", () => {
    const dated = POOL.map((p) => yearOf(p.url)).filter((y): y is number => y != null);
    // Non-vacuity: if the URLs stopped carrying years this filter would quietly
    // become a no-op and every test below would still pass.
    expect(dated.length).toBeGreaterThan(200);
    const modern = dated.filter((y) => y >= 2000).length;
    expect(modern / dated.length).toBeGreaterThan(0.8);
  });

  it("keeps the whole pool when there is no era clock", () => {
    const pool = [{ photoYear: 2020 }, { photoYear: null }];
    expect(portraitsForYear(pool, null)).toEqual(pool);
    expect(portraitsForYear(pool, undefined)).toEqual(pool);
  });

  // The bug this exists to fix.
  it("excludes a modern photograph from a 1953 world", () => {
    const pool = [{ photoYear: 2015 }, { photoYear: 1950 }];
    expect(portraitsForYear(pool, 1953)).toEqual([{ photoYear: 1950 }]);
  });

  // Unknown must not be read as old. An undated portrait has no evidence either
  // way, and excluding it would throw away two thirds of the pool on a guess.
  it("treats an undated photograph as eligible everywhere", () => {
    const pool = [{ photoYear: null }];
    expect(portraitsForYear(pool, 1953)).toEqual(pool);
    expect(portraitsForYear(pool, 2019)).toEqual(pool);
  });

  // Asymmetric on purpose: near-contemporary reads fine, and being strict
  // forwards would strip the modern pool for no gain.
  it("allows a slightly-later photograph but not a much-later one", () => {
    expect(portraitsForYear([{ photoYear: 2024 }], 2019)).toHaveLength(1);
    // Needs a second, eligible entry — otherwise the never-empty guard below
    // returns the whole pool and the filter is invisible.
    expect(portraitsForYear([{ photoYear: 2015 }, { photoYear: 1950 }], 1953)).toEqual([
      { photoYear: 1950 },
    ]);
  });

  // A missing portrait is worse than an anachronistic one.
  it("never empties a pool whose every entry is modern", () => {
    const pool = [{ photoYear: 2020 }, { photoYear: 2021 }];
    expect(portraitsForYear(pool, 1953)).toEqual(pool);
  });

  it("a 1953 US pick is never a datably-modern photograph", () => {
    const byId = new Map(POOL.map((p) => [p.id, p]));
    for (let i = 0; i < 60; i++) {
      const url = selectPoliticianImage("US", "male", "white", "Fictional Nobody", 1953);
      if (!url) continue;
      const id = url.split("/").pop()!;
      const row = byId.get(id);
      expect(row, id).toBeDefined();
      const year = yearOf(row!.url);
      if (year != null) expect(year, `${row!.name} (${year})`).toBeLessThanOrEqual(1973);
    }
  });

  it("a modern world still reaches the modern portraits", () => {
    const byId = new Map(POOL.map((p) => [p.id, p]));
    const years: number[] = [];
    for (let i = 0; i < 120; i++) {
      const url = selectPoliticianImage("US", "male", "white", "Fictional Nobody", 2019);
      if (!url) continue;
      const row = byId.get(url.split("/").pop()!);
      const y = row ? yearOf(row.url) : null;
      if (y != null) years.push(y);
    }
    expect(
      years.some((y) => y >= 2000),
      "no modern portrait drawn in a 2019 world"
    ).toBe(true);
  });
});
