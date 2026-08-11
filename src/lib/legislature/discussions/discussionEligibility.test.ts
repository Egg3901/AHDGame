import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { canPostBillDiscussion } from "./discussionEligibility";
import type { Character } from "@/lib/db/types";

function character(): Character {
  return { _id: new ObjectId(), party: "1", homeState: "CA" } as unknown as Character;
}

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  db.collection("electedOfficials");
});

describe("canPostBillDiscussion", () => {
  it("allows a US lower-chamber (house) member on a national bill", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });
    const ok = await canPostBillDiscussion(db as never, character(), {
      kind: "national",
      countryId: "US",
      billId: new ObjectId().toString(),
    });
    expect(ok).toBe(true);
    const filter = db.collectionMocks.electedOfficials!.findOne.mock.calls[0][0];
    expect(filter.officeType.$in).toContain("house");
    expect(filter.officeType.$in).toContain("senate");
    expect(filter.countryId).toBe("US");
  });

  it("maps CN chamber key 'npc' to the stored officeType 'npcDelegate'", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });
    const ok = await canPostBillDiscussion(db as never, character(), {
      kind: "national",
      countryId: "CN",
      billId: new ObjectId().toString(),
    });
    expect(ok).toBe(true);
    const filter = db.collectionMocks.electedOfficials!.findOne.mock.calls[0][0];
    expect(filter.officeType.$in).toContain("npcDelegate");
    expect(filter.officeType.$in).not.toContain("npc");
    expect(filter.countryId).toBe("CN");
  });

  it("rejects a non-member on a national bill", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
    const ok = await canPostBillDiscussion(db as never, character(), {
      kind: "national",
      countryId: "US",
      billId: new ObjectId().toString(),
    });
    expect(ok).toBe(false);
  });

  it("queries the sub-national office + uppercased state for a state bill", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });
    const ok = await canPostBillDiscussion(db as never, character(), {
      kind: "state",
      countryId: "US",
      stateId: "az",
      billId: new ObjectId().toString(),
    });
    expect(ok).toBe(true);
    const filter = db.collectionMocks.electedOfficials!.findOne.mock.calls[0][0];
    expect(filter.state).toBe("AZ");
    expect(filter.countryId).toBe("US");
    expect(typeof filter.officeType).toBe("string");
  });

  it("rejects a non-member on a state bill", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
    const ok = await canPostBillDiscussion(db as never, character(), {
      kind: "state",
      countryId: "US",
      stateId: "AZ",
      billId: new ObjectId().toString(),
    });
    expect(ok).toBe(false);
  });
});
