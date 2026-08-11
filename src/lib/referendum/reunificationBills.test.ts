import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createReunificationConsentBills } from "./reunificationBills";
import { CONVERSION_WINDOW_TURNS } from "@/lib/constants/referendum";
import type { Referendum } from "@/lib/db/types/referendum";

function refDoc(): Referendum {
  return {
    _id: "507f1f77bcf86cd799439011" as unknown as Referendum["_id"],
    countryId: "UK",
    regionId: "NIR",
    kind: "reunification",
    targetCountryId: "IE",
    status: "actuating",
    requestedTurn: 100,
    grantedTurn: 110,
    campaignOpenTurn: 110,
    campaignCloseTurn: 158,
    yesShare: 60,
    campaignBaseYesShare: 60,
    campaignSpendUnits: { yes: 0, no: 0 },
    conversionDeadlineTurn: 200,
    westminsterBillId: null,
    dailBillId: null,
    result: null,
    cooldownReadyAtTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("createReunificationConsentBills", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("creates a Westminster Commons bill and a Dáil bill, both active + provision-less", async () => {
    const ids = await createReunificationConsentBills(db as unknown as Db, refDoc(), 176);
    const bills = db.collectionMocks["bills"].insertOne.mock.calls.map((c) => c[0]);
    expect(bills).toHaveLength(2);

    const uk = bills.find((b) => b.countryId === "UK")!;
    const ie = bills.find((b) => b.countryId === "IE")!;

    expect(uk.originChamber).toBe("commons");
    expect(uk.stateId).toBe("uk_national");
    expect(uk.title).toMatch(/Northern Ireland/i);
    expect(ie.originChamber).toBe("dail");
    expect(ie.stateId).toBe("ie_national");
    expect(ie.title).toMatch(/Reunification/i);

    for (const b of bills) {
      expect(b.status).toBe("active");
      expect(b.category).toBe("reunification");
      expect(b.provisions).toEqual([]);
      expect(b.sponsorId).toBeNull();
      expect(b.votingEndsOnTurn).toBe(176 + CONVERSION_WINDOW_TURNS);
    }

    expect(String(ids.westminsterBillId)).toBe(String(uk._id));
    expect(String(ids.dailBillId)).toBe(String(ie._id));
  });
});
