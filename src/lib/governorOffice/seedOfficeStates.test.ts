import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedOfficeStates } from "./seedOfficeStates";
import { getCollectionCategory } from "@/lib/admin/seed/seedManifest";

describe("Westminster stance lifecycle", () => {
  it("initializes all three stances without a cooldown and uses a reset-cleared collection", async () => {
    const db = createMockDb();
    await seedOfficeStates(db as unknown as Db, 0, "1991-default");
    const rows = db.collection("governorOfficeState").insertMany.mock.calls[0][0];
    const national = rows.find((row: { stateId: string }) => row.stateId === "uk_national");
    expect(national.westminsterStances).toEqual({
      SCO: { policy: "anti" },
      WAL: { policy: "anti" },
      NIR: { policy: "anti" },
    });
    expect(getCollectionCategory("governorOfficeState")).toBe("runtime");
  });
  it("does not overwrite an existing world's policies during idempotent seeding", async () => {
    const db = createMockDb();
    db.collection("governorOfficeState")
      .find()
      .toArray.mockResolvedValue([{ countryId: "UK", stateId: "uk_national" }]);
    await seedOfficeStates(db as unknown as Db, 100, "2019-default");
    const rows = db.collection("governorOfficeState").insertMany.mock.calls[0][0];
    expect(rows.some((row: { stateId: string }) => row.stateId === "uk_national")).toBe(false);
    expect(db.collection("governorOfficeState").updateOne).not.toHaveBeenCalled();
  });
});
