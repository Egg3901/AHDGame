import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { modernRegions2019 } from "@/lib/seeds/reference/modernRegions2019";
import { PARTY_ROSTERS_2019 } from "@/lib/seeds/partyRosters2019";
import { seedModern2019 } from "./seedModern2019";

describe("2019 transition-country seed", () => {
  it("seeds all five democratic NPP countries without leaking into 1953", async () => {
    const db = createInMemoryDb() as unknown as Db;
    const log: string[] = [];
    await seedModern2019(db, true, (message) => log.push(message), "1953-default");
    expect(await db.collection("states").countDocuments({})).toBe(0);

    await seedModern2019(db, true, (message) => log.push(message), "2019-default");
    for (const countryId of ["RU", "PL", "HU", "RO", "BG"] as const) {
      const count = modernRegions2019(countryId).length;
      expect(await db.collection("states").countDocuments({ countryId }), countryId).toBe(count);
      expect(await db.collection("macroMetrics").countDocuments({ countryId })).toBe(count);
      expect(await db.collection("stateDemographics").countDocuments({ countryId })).toBe(count);
      expect(await db.collection("politicalParties").countDocuments({ countryId })).toBe(
        PARTY_ROSTERS_2019[countryId]!.length
      );
      expect(await db.collection("statePartyOrg").countDocuments({ countryId })).toBe(
        count * PARTY_ROSTERS_2019[countryId]!.length
      );
      expect(await db.collection("stateBaselines").countDocuments({
        _id: { $in: modernRegions2019(countryId).map((region) => region._id) },
      })).toBe(count);
    }
    expect(log.filter((message) => message.includes("2019 regions"))).toHaveLength(5);
  });
});
