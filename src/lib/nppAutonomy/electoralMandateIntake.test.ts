import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadElectoralMandate } from "./electoralMandateIntake";

describe("electoral mandate platform intake", () => {
  it("loads a governing party's platform from the political party store", async () => {
    const db = createMockDb();
    db.collection("politicalParties").findOne.mockResolvedValue({
      economicPosition: -3,
      socialPosition: 1,
    });
    const mandate = await loadElectoralMandate(
      db as unknown as Db,
      "UK",
      { governingPartyId: "12", seatsByParty: { "12": 360 }, totalSeats: 650 },
      1
    );
    expect(mandate).toMatchObject({ partyId: "12", sources: ["platform"], computedTurn: 1 });
    expect(mandate?.domains.poverty).toBeGreaterThan(0);
    expect(db.collectionMocks.politicalParties.findOne).toHaveBeenCalledWith(
      { countryId: "UK", sequentialId: 12 },
      { projection: { economicPosition: 1, socialPosition: 1 } }
    );
    expect(db.collectionMocks.parties).toBeUndefined();
  });

  it("keeps a missing governing-party record without a mandate", async () => {
    const db = createMockDb();
    expect(
      await loadElectoralMandate(
        db as unknown as Db,
        "UK",
        { governingPartyId: "12", seatsByParty: { "12": 360 }, totalSeats: 650 },
        1
      )
    ).toBeNull();
  });
});
