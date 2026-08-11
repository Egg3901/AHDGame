import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildBrGovernmentFormation } from "./brGovernmentFormation";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

describe("buildBrGovernmentFormation", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("stays pending when no BR president is seated", async () => {
    db.collectionMocks["electedOfficials"] = db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"].findOne = vi.fn().mockResolvedValue(null);

    const doc = await buildBrGovernmentFormation(db as unknown as Db, new Date("1953-01-01"));
    expect(doc.status).toBe("pending");
    expect(doc.presidentNppId).toBeNull();
    expect(doc.governingPartyId).toBeNull();
    expect(doc.formedAt).toBeNull();
  });

  it("links a seated NPP president as FORMED (1953 PTB seed path)", async () => {
    const nppId = new ObjectId();
    db.collectionMocks["electedOfficials"] = db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"].findOne = vi.fn().mockResolvedValue({
      countryId: "BR",
      officeType: "president",
      nppId,
      characterName: "Ana Souza",
      party: "3",
      isNPP: true,
    });

    const now = new Date("1953-01-01");
    const doc = await buildBrGovernmentFormation(db as unknown as Db, now);
    expect(doc.status).toBe("formed");
    expect(doc.formationType).toBe("majority");
    expect(doc.presidentNppId).toEqual(nppId);
    expect(doc.presidentName).toBe("Ana Souza");
    expect(doc.pmName).toBe("Ana Souza");
    expect(doc.governingPartyId).toBe("3");
    expect(doc.formedAt).toEqual(now);
    expect(doc.formedTurn).toBe(1);
    expect(doc.majorityThreshold).toBe(257);
    expect(doc.totalSeats).toBe(513);
  });
});
