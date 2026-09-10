import { describe, it, expect } from "vitest";
import {
  CROSSOVER_RATES_1953,
  CROSSOVER_RATES_MODERN,
  crossoverRatesForPreset,
  deriveZweitstimmen,
  validateZweitstimmenSum,
  type PartyCrossoverRate,
} from "./ticketSplitCrossover";

// Live party ids are `sequentialId` strings, not slugs.
const IDS = { cdu: "2", spd: "1", fdp: "5", dp: "6", grn: "4" };
const SLUGS: Record<string, string> = {
  cdu: IDS.cdu,
  spd: IDS.spd,
  fdp: IDS.fdp,
  dp: IDS.dp,
  grn: IDS.grn,
};

const total = (rows: { votes: number }[]) => rows.reduce((s, r) => s + r.votes, 0);

describe("ticket-split crossover (#810)", () => {
  // The defect: the layer always hit its default bucket and returned first-vote
  // totals unchanged in every Land.
  it("actually moves second votes away from the first-vote totals", () => {
    const erst = [
      { partyId: IDS.cdu, votes: 1_000_000 },
      { partyId: IDS.fdp, votes: 200_000 },
    ];
    const out = deriveZweitstimmen(erst, [{ fromParty: "cdu", toParty: "fdp", rate: 0.07 }], SLUGS);
    const byId = Object.fromEntries(out.map((o) => [o.partyId, o.votes]));
    expect(byId[IDS.cdu]).toBe(930_000);
    expect(byId[IDS.fdp]).toBe(270_000);
  });

  it("conserves total ballots — crossover redistributes, it does not mint", () => {
    const erst = [
      { partyId: IDS.cdu, votes: 1_234_567 },
      { partyId: IDS.spd, votes: 987_654 },
      { partyId: IDS.grn, votes: 321_098 },
    ];
    const out = deriveZweitstimmen(erst, CROSSOVER_RATES_MODERN, SLUGS);
    expect(validateZweitstimmenSum(erst, out)).toBe(true);
    expect(Math.abs(total(out) - total(erst))).toBeLessThanOrEqual(out.length);
  });

  // Every rule names a party by slug; a world without that party must not
  // receive phantom votes for it.
  it("drops rules whose parties do not exist under the active preset", () => {
    const erst = [{ partyId: IDS.cdu, votes: 1_000_000 }];
    const out = deriveZweitstimmen(
      erst,
      [{ fromParty: "cdu", toParty: "afd", rate: 0.2 }],
      SLUGS // no afd
    );
    expect(out).toEqual([{ partyId: IDS.cdu, votes: 1_000_000 }]);
  });

  it("never lends out more than a party received", () => {
    const erst = [{ partyId: IDS.cdu, votes: 100_000 }];
    const greedy: PartyCrossoverRate[] = [
      { fromParty: "cdu", toParty: "fdp", rate: 0.8 },
      { fromParty: "cdu", toParty: "spd", rate: 0.8 },
    ];
    const out = deriveZweitstimmen(erst, greedy, SLUGS);
    const byId = Object.fromEntries(out.map((o) => [o.partyId, o.votes]));
    expect(byId[IDS.cdu]).toBe(0);
    expect(total(out)).toBe(100_000);
  });

  it("ignores self-referential and non-positive rules", () => {
    const erst = [{ partyId: IDS.cdu, votes: 500_000 }];
    const out = deriveZweitstimmen(
      erst,
      [
        { fromParty: "cdu", toParty: "cdu", rate: 0.5 },
        { fromParty: "cdu", toParty: "fdp", rate: 0 },
      ],
      SLUGS
    );
    expect(out).toEqual([{ partyId: IDS.cdu, votes: 500_000 }]);
  });

  it("leaves an empty race empty", () => {
    expect(deriveZweitstimmen([], CROSSOVER_RATES_MODERN, SLUGS)).toEqual([]);
  });

  describe("era scoping", () => {
    it("selects a table per preset and defaults to modern", () => {
      expect(crossoverRatesForPreset("1953-default")).toBe(CROSSOVER_RATES_1953);
      expect(crossoverRatesForPreset("2019-default")).toBe(CROSSOVER_RATES_MODERN);
      expect(crossoverRatesForPreset(undefined)).toBe(CROSSOVER_RATES_MODERN);
    });

    // The two-vote ballot was one election old in 1953 and splitting was
    // marginal; the Leihstimme is a 1961-onward behaviour.
    it("keeps 1953 splitting marginal", () => {
      const outgoing = CROSSOVER_RATES_1953.filter((r) => r.fromParty === "cdu");
      expect(outgoing.reduce((s, r) => s + r.rate, 0)).toBeLessThan(0.08);
    });

    it("names no party that is an anachronism in 1953", () => {
      const anachronisms = new Set(["grn", "lnk", "afd", "pds"]);
      for (const rule of CROSSOVER_RATES_1953) {
        expect(anachronisms.has(rule.fromParty), rule.fromParty).toBe(false);
        expect(anachronisms.has(rule.toParty), rule.toParty).toBe(false);
      }
    });

    // Guards the class of bug this replaced: a table naming parties that are
    // in no seed silently does nothing.
    it("only names slugs the DE seed actually defines", () => {
      const seeded = new Set([
        "spd",
        "cdu",
        "csu",
        "grn",
        "fdp",
        "lnk",
        "afd",
        "pds",
        "dp",
        "gbbhe",
      ]);
      for (const table of [CROSSOVER_RATES_1953, CROSSOVER_RATES_MODERN]) {
        for (const rule of table) {
          expect(seeded.has(rule.fromParty), rule.fromParty).toBe(true);
          expect(seeded.has(rule.toParty), rule.toParty).toBe(true);
        }
      }
    });
  });
});
