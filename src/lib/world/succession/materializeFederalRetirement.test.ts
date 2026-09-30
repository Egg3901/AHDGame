import type { ClientSession, Db, Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeFederationFederalRetirement } from "./materializeFederalRetirement";

describe("dissolved federation political retirement", () => {
  it("vacates active offices and upcoming votes while retaining completed election history", async () => {
    const mem = createInMemoryDb();
    mem.seed("countryGameStates", [{ _id: "CS", dissolvedTurn: null }]);
    mem.seed("elections", [
      { _id: "future", countryId: "CS", status: "upcoming" },
      { _id: "past", countryId: "CS", status: "completed" },
    ]);
    mem.seed("electedOfficials", [{ _id: "federal-seat", countryId: "CS" }]);
    mem.seed("governmentFormations", [{ _id: "CS", status: "active", pmName: "Old PM" }]);
    const db = mem as unknown as Db;
    expect(
      await materializeFederationFederalRetirement({
        db,
        session: {} as ClientSession,
        sourceCountryId: "CS",
        appliedOnTurn: 97,
        now: new Date(10),
      })
    ).toEqual({ cancelledElections: 1, vacatedOffices: 1 });
    expect(
      await db.collection<Document & { _id: string }>("elections").findOne({ _id: "future" })
    ).toMatchObject({ status: "cancelled" });
    expect(
      await db.collection<Document & { _id: string }>("elections").findOne({ _id: "past" })
    ).toMatchObject({ status: "completed" });
    expect(await db.collection("electedOfficials").countDocuments({})).toBe(0);
    expect(
      await db.collection<Document & { _id: string }>("countryGameStates").findOne({ _id: "CS" })
    ).toMatchObject({ dissolvedTurn: 97 });
  });
});
