import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { processRuLegislatureTransition } from "./ruLegislatureTransition";

const NOW = new Date("2026-01-01T00:00:00Z");

describe("Russian 1993 legislature transition", () => {
  it("does not advance the clock during the founding phase or other presets", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    expect(await processRuLegislatureTransition(db, { preset: "1979-default" }, 141, NOW)).toBe(
      "none"
    );
    expect(
      await processRuLegislatureTransition(
        db,
        { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        200,
        NOW
      )
    ).toBe("none");
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 128, NOW)).toBe(
      "none"
    );
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("retires Congress in September and opens the Assembly once in January", async () => {
    const writes: Array<[string, unknown]> = [];
    const markers: Record<string, number> = {};
    const regionIds = Object.keys(
      (await import("@/lib/countries/ru/data/ruPopulation1991")).RU_1991_ECONOMIC_REGION_POPULATION
    );
    const db = {
      collection: (name: string) => ({
        findOne: async () => (name === "countryGameStates" ? { _id: "RU", ...markers } : null),
        find: () => ({ toArray: async () => regionIds.map((_id) => ({ _id })) }),
        deleteMany: async (filter: unknown) => {
          writes.push([name, filter]);
        },
        updateOne: async (_filter: unknown, update: { $set?: Record<string, number> }) => {
          writes.push([name, update]);
          if (name === "countryGameStates") Object.assign(markers, update.$set);
        },
        bulkWrite: async (operations: unknown) => {
          writes.push([name, operations]);
        },
      }),
    } as unknown as Db;
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 129, NOW)).toBe(
      "dissolved"
    );
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 130, NOW)).toBe(
      "none"
    );
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 141, NOW)).toBe(
      "none"
    );
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 145, NOW)).toBe(
      "federalAssembly"
    );
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 146, NOW)).toBe(
      "none"
    );
    expect(writes).toContainEqual([
      "electedOfficials",
      { countryId: "RU", officeType: "congressDeputy" },
    ]);
    const regions = writes.find(([name]) => name === "states")?.[1] as Array<{
      updateOne: { update: { $set: { houseDistricts: number; stateSenateSeats: number } } };
    }>;
    expect(regions.reduce((sum, row) => sum + row.updateOne.update.$set.houseDistricts, 0)).toBe(
      225
    );
    expect(regions.every((row) => row.updateOne.update.$set.stateSenateSeats === 0)).toBe(true);
    expect(markers.ruCongressDissolvedSinceTurn).toBe(129);
    expect(markers.ruFederalAssemblySinceTurn).toBe(145);
  });
});
