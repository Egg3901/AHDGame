import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { distributeSubdivisionVotes } from "@/lib/utils/subdivisionResults";
import legacyFixtures from "./__fixtures__/usCountyParity.legacy.json";

// Byte-identical outputs captured from the legacy distributeCountyVotes engine
// (deleted in the Phase 2 unification) over real county data. The generic
// engine must reproduce them exactly — any drift here is a regression in how
// historical US elections render.

const load = (st: string) =>
  (
    JSON.parse(
      readFileSync(join(process.cwd(), "src", "data", "counties", `${st}.json`), "utf-8")
    ) as {
      counties: { fips: string; name: string; path: string; population: number; cookPVI: number }[];
    }
  ).counties;

const TALLIES: Record<string, number>[] = [
  { c1: 152341, c2: 98765 },
  { c1: 152341, c2: 98765, c3: 12001 }, // 3-way incl. independent
  { c1: 10 }, // single candidate
  { c1: 500000, c2: 500000 }, // exact statewide tie — exercises tie-breaking
];
// legacy-route lean mapping: econ<0 → "democrat", >0 → "republican", 0 → "independent"
const ECON: Record<string, number>[] = [
  { c1: -2, c2: 2 },
  { c1: -2, c2: 2, c3: 0 },
  { c1: -2 },
  { c1: -2, c2: 2 },
];

describe("US county parity: generic engine === captured legacy outputs", () => {
  for (const st of ["WY", "PA", "NH"] as const) {
    const counties = load(st);
    it.each(TALLIES.map((_, i) => [i] as const))(`${st} tally fixture %d`, (i) => {
      const generic = distributeSubdivisionVotes(
        counties.map((c) => ({
          id: c.fips,
          name: c.name,
          electorate: c.population,
          leanScalar: c.cookPVI,
        })),
        { ...TALLIES[i] },
        Object.fromEntries(
          Object.keys(TALLIES[i]).map((cid) => [cid, { econPosition: ECON[i][cid] }])
        )
      );
      expect(generic).toEqual(legacyFixtures[st][i]);
    });
  }
});
