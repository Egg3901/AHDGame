import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { assignByLeanOrdering } from "@/lib/utils/subdivisionResults";
import legacyFixtures from "./__fixtures__/usCdParity.legacy.json";

// Byte-identical outputs captured from the legacy assignCDSeats function
// (deleted in the Phase 3 unification) over real CD data. The generic
// lean-ordering strategy must reproduce them exactly.

const SCENARIOS = [
  { seatsWon: { c1: 20, c2: 18 }, parties: { c1: "1", c2: "2" }, econ: { "1": -2, "2": 2 } },
  { seatsWon: { c1: 10, c2: 5 }, parties: { c1: "1", c2: "2" }, econ: { "1": -2, "2": 2 } },
  {
    seatsWon: { c1: 15, c2: 15, c3: 8 },
    parties: { c1: "1", c2: "2", c3: "3" },
    econ: { "1": -2, "2": 2, "3": 0 },
  },
  { seatsWon: {}, parties: {}, econ: {} },
] as const;

describe("US CD parity: assignByLeanOrdering === captured assignCDSeats outputs", () => {
  for (const st of ["TX", "CA", "WY"] as const) {
    const districts = (
      JSON.parse(
        readFileSync(
          join(process.cwd(), "src", "data", "congressional-districts", `${st}.json`),
          "utf-8"
        )
      ) as { districts: { cd: string; cookPVI: number }[] }
    ).districts;
    const subs = districts.map((d) => ({
      id: d.cd,
      name: d.cd,
      electorate: 0,
      leanScalar: d.cookPVI,
    }));
    it.each(SCENARIOS.map((_, i) => [i] as const))(`${st} scenario %d`, (i) => {
      const sc = SCENARIOS[i];
      const generic = assignByLeanOrdering(
        subs,
        { ...sc.seatsWon },
        { ...sc.parties },
        { ...sc.econ }
      );
      expect(generic).toEqual(legacyFixtures[st][i]);
    });
  }
});
