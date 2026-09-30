import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";
import { openDefaultFederationPoliticalProposal } from "./defaultProposal";

describe("1991 default federation proposals", () => {
  for (const row of [
    {
      sourceCountryId: "CS" as const,
      year: 1992,
      states: csRegions1991,
      successors: ["CZ2", "SK"],
    },
    {
      sourceCountryId: "YU" as const,
      year: 1991,
      states: yuRegions1991,
      successors: ["BA", "HR", "MK", "SI", "YF"],
    },
  ]) {
    it(`conserves all ${row.sourceCountryId} regions in a rejectable bill`, async () => {
      const mem = createInMemoryDb();
      mem.seed("gameState", [
        {
          _id: "current",
          preset: "1991-default",
          currentYear: row.year,
          currentTurn: 96,
        },
      ]);
      mem.seed("states", row.states);
      const proposal = await openDefaultFederationPoliticalProposal({
        db: mem as unknown as Db,
        sourceCountryId: row.sourceCountryId,
        currentYear: row.year,
        now: new Date(0),
        negotiatedCustodians: {},
      });
      expect(proposal.terms.successors.map(({ entityId }) => entityId)).toEqual(row.successors);
      expect(proposal.terms.territories.flatMap(({ regionIds }) => regionIds).sort()).toEqual(
        row.states.map(({ _id }) => _id).sort()
      );
      expect(proposal.terms.assetBasis).toBe("population");
      expect(await mem.collection("bills").countDocuments({ status: "active" })).toBe(1);
    });
  }
});
