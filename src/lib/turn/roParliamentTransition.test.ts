import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import {
  RO_1992_DEPUTIES_BY_REGION,
  RO_1992_SENATORS_BY_REGION,
} from "@/lib/countries/ro/rules/parliament1992";
import { processRoParliamentTransition } from "./roParliamentTransition";

const NOW = new Date("2026-01-01T00:00:00Z");
const cursor = <T>(docs: T[]) => ({ toArray: vi.fn().mockResolvedValue(docs) });

function readyDb() {
  const db = createMockDb();
  db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "RO" });
  db.collection("states").find.mockReturnValue(cursor(roRegions1991));
  db.collection("elections").find.mockImplementation((filter: { electionType: string }) =>
    cursor(
      Object.entries(
        filter.electionType === "senat" ? RO_1992_SENATORS_BY_REGION : RO_1992_DEPUTIES_BY_REGION
      ).map(([state, totalSeats]) => ({ state, totalSeats }))
    )
  );
  db.collection("electedOfficials").find.mockReturnValue(
    cursor([
      { _id: "dep-a", state: "RO_BUC", officeType: "deputy", seatsHeld: 30 },
      { _id: "dep-b", state: "RO_BUC", officeType: "deputy", seatsHeld: 10 },
      { _id: "sen-a", state: "RO_BUC", officeType: "senator", seatsHeld: 10 },
    ])
  );
  return db;
}

describe("Romania's 1992 parliamentary seat transition", () => {
  it("requires resolved slates and moves regions, officials, formation before the marker", async () => {
    const db = readyDb();
    const writes: string[] = [];
    db.collection("states").bulkWrite.mockImplementation(async () => {
      writes.push("regions");
    });
    db.collection("electedOfficials").bulkWrite.mockImplementation(async () => {
      writes.push("officials");
    });
    db.collection("governmentFormations").updateOne.mockImplementation(async () => {
      writes.push("formation");
    });
    db.collection("countryGameStates").updateOne.mockImplementation(async () => {
      writes.push("marker");
    });
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1991-default" }, 96, NOW)
    ).toBe(true);
    expect(writes).toEqual(["regions", "officials", "formation", "marker"]);
    const regions = db.collection("states").bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { houseDistricts: number; stateSenateSeats: number } } };
    }>;
    expect(regions.reduce((n, op) => n + op.updateOne.update.$set.houseDistricts, 0)).toBe(341);
    expect(regions.reduce((n, op) => n + op.updateOne.update.$set.stateSenateSeats, 0)).toBe(143);
    const officials = db.collection("electedOfficials").bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { seatsHeld: number } } };
    }>;
    expect(
      officials
        .filter((op) => op.updateOne.filter._id.startsWith("dep"))
        .reduce((n, op) => n + op.updateOne.update.$set.seatsHeld, 0)
    ).toBe(RO_1992_DEPUTIES_BY_REGION.RO_BUC);
    expect(
      officials.find((op) => op.updateOne.filter._id === "sen-a")?.updateOne.update.$set.seatsHeld
    ).toBe(RO_1992_SENATORS_BY_REGION.RO_BUC);
    expect(db.collection("governmentFormations").updateOne.mock.calls[0]![1].$set).toMatchObject({
      totalSeats: 341,
      majorityThreshold: 171,
    });
    expect(db.collection("countryGameStates").updateOne.mock.calls[0]![1].$set).toMatchObject({
      roParliament1992SinceTurn: 96,
    });
  });

  it("does not transition before 1992, with a missing slate, or outside the 1991 preset", async () => {
    const db = readyDb();
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1991-default" }, 95, NOW)
    ).toBe(false);
    expect(
      await processRoParliamentTransition(
        db as unknown as Db,
        { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        196,
        NOW
      )
    ).toBe(false);
    db.collection("elections").find.mockReturnValue(cursor([]));
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1991-default" }, 96, NOW)
    ).toBe(false);
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1979-default" }, 96, NOW)
    ).toBe(false);
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "2027-default" }, 96, NOW)
    ).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });

  it("waits when a resolved race still carries the wrong magnitude", async () => {
    const db = readyDb();
    db.collection("elections").find.mockImplementation((filter: { electionType: string }) =>
      cursor(
        Object.entries(
          filter.electionType === "senat" ? RO_1992_SENATORS_BY_REGION : RO_1992_DEPUTIES_BY_REGION
        ).map(([state, totalSeats], index) => ({
          state,
          totalSeats: index === 0 ? totalSeats + 1 : totalSeats,
        }))
      )
    );
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1991-default" }, 96, NOW)
    ).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });

  it("does not repeat after the durable marker", async () => {
    const db = readyDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "RO",
      roParliament1992SinceTurn: 96,
    });
    expect(
      await processRoParliamentTransition(db as unknown as Db, { preset: "1991-default" }, 97, NOW)
    ).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });
});
