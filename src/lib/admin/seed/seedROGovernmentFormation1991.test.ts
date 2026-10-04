import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedROGovernmentFormation1991 } from "./seedROGovernmentFormation1991";

describe("1991 Romanian government formation seed", () => {
  it("opens a 396-deputy formation with the engine's 199-vote majority", async () => {
    const db = createMockDb();
    await seedROGovernmentFormation1991(db as unknown as Db, vi.fn(), "1991-default");
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledWith(
      { _id: "RO" },
      expect.objectContaining({
        $set: expect.objectContaining({
          countryId: "RO",
          status: "pending",
          totalSeats: 396,
          majorityThreshold: 199,
          pmCharacterId: null,
          pmNppId: null,
        }),
      }),
      { upsert: true }
    );
  });

  it.each(["1979-default", "2027-default"])("does not write on %s", async (preset) => {
    const db = createMockDb();
    await seedROGovernmentFormation1991(db as unknown as Db, vi.fn(), preset);
    expect(db.collection("governmentFormations").updateOne).not.toHaveBeenCalled();
  });
});
