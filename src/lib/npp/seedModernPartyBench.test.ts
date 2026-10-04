import type { Db, Document } from "mongodb";
import { expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { seedModernPartyBench } from "./seedModernPartyBench";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(() => {
    throw new Error("Bootstrap must use its injected database");
  }),
}));

it("supplies and reuses an unseated party bench through the in-memory bootstrap adapter", async () => {
  const db = createInMemoryDb() as unknown as Db;
  await db.collection<Document & { _id: string }>("states").insertOne({
    _id: "PL_MAZ",
    countryId: "PL",
  });
  await db.collection("politicalParties").insertOne({
    countryId: "PL",
    sequentialId: 1,
    isDefault: true,
    memberCount: 0,
    economicPosition: 0,
    socialPosition: 0,
  });
  expect(await seedModernPartyBench(db, "2019-default")).toBe(1);
  const actor = await db.collection("npps").findOne({ countryId: "PL", party: "1" });
  expect(actor).toMatchObject({
    homeState: "PL_MAZ",
    currentOffice: null,
    funds: 0,
    retiredAt: null,
  });
  expect(actor?.name).toBeTruthy();
  expect(await seedModernPartyBench(db, "2019-default")).toBe(0);
  expect(await db.collection("npps").countDocuments({})).toBe(1);
  expect(await db.collection("electedOfficials").countDocuments({})).toBe(0);
  expect((await db.collection("politicalParties").findOne({ countryId: "PL" }))?.memberCount).toBe(
    0
  );
});
