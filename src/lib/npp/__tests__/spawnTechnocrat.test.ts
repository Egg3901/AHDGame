import { describe, it, expect, vi } from "vitest";
import { spawnTechnocratNpp } from "../generator";

function mockDb() {
  const inserted: any[] = [];
  const insertOne = vi.fn(async (doc: any) => {
    inserted.push(doc);
    return { insertedId: doc._id };
  });
  const db = { collection: () => ({ insertOne }) } as any;
  return { db, inserted };
}

describe("spawnTechnocratNpp", () => {
  it("inserts an NPP with isTechnocrat + role and a non-empty name", async () => {
    const { db, inserted } = mockDb();
    const npp = await spawnTechnocratNpp(db, "us" as any, "centralBankChair");
    expect(npp.isTechnocrat).toBe(true);
    expect(npp.technocratRole).toBe("centralBankChair");
    expect(npp.countryId).toBe("us");
    expect(typeof npp.name).toBe("string");
    expect(npp.name.length).toBeGreaterThan(0);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].isTechnocrat).toBe(true);
  });
});
