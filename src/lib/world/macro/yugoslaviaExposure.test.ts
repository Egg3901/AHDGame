import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processMacroCountryTurn } from "./macroCountryTurn";
import { getAustria1953MacroCountry } from "./austria1953";
import { computeMacroContribution } from "./kernel";
import { macroTickBucket } from "./schedule";
import type { MacroCountryState } from "./types";

describe("Yugoslav crisis in the macro economy", () => {
  it("persists reduced market supply, replays without stacking, and rebuilds from original capacity", async () => {
    const db = createMockDb();
    const country = {
      ...getAustria1953MacroCountry(),
      _id: "YU",
      entityId: "YU",
      tickBucket: macroTickBucket("YU"),
    } as MacroCountryState;
    const turn = 241 + macroTickBucket(country.entityId);
    db.collection("macroCountries");
    db.collectionMocks.macroCountries!.find.mockReturnValue({ toArray: async () => [country] });
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({ livingConflictsEnabled: true });
    const crisis = {
      hasOpened: true,
      status: "active",
      tracks: { displacement: 100, infrastructureDamage: 100, reconstruction: 0 },
    };
    db.collection("livingConflicts");
    db.collectionMocks.livingConflicts!.findOne.mockResolvedValue(crisis);
    db.collectionMocks.macroCountries!.bulkWrite.mockImplementation(async (ops) => {
      Object.assign(country, ops[0].updateOne.update.$set);
      return { ok: 1 };
    });
    const baseline = computeMacroContribution(country, turn);
    await processMacroCountryTurn(db as unknown as Db, turn);
    expect(country.contribution.bySector.manufacturing!.output).toBeLessThan(
      baseline.bySector.manufacturing!.output
    );
    const supply = (contribution: typeof baseline) =>
      Object.values(contribution.byCommodity).reduce((sum, flow) => sum + (flow?.supply ?? 0), 0);
    expect(supply(country.contribution)).toBeLessThan(supply(baseline));
    expect(country.livingConflictExposure?.displacedShare).toBe(0.003);
    const first = structuredClone(country.contribution);
    await processMacroCountryTurn(db as unknown as Db, turn);
    expect(country.contribution).toEqual(first);
    crisis.tracks = { displacement: 0, infrastructureDamage: 100, reconstruction: 100 };
    await processMacroCountryTurn(db as unknown as Db, turn + 6);
    expect(country.contribution.bySector).toEqual(baseline.bySector);
    expect(country.contribution.byCommodity).toEqual(baseline.byCommodity);
  });
});
