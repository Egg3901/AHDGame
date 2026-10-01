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
    mem.seed("governmentFormations", [
      {
        _id: "CS",
        status: "active",
        pmName: "Old PM",
        hosName: "Old head",
        coalitionPartyIds: ["1"],
        activeVoteId: "nomination",
      },
    ]);
    mem.seed("npps", [
      { _id: "old-npp", countryId: "CS", currentOffice: { type: "federalAssemblyDeputy" } },
      { _id: "foreign-npp", countryId: "PL", currentOffice: { type: "sejmDeputy" } },
    ]);
    mem.seed("characters", [
      {
        _id: "resident",
        countryId: "CS",
        currentOffice: { type: "parliamentaryCabinet" },
        cash: 50,
        federationPendingResidenceId: "protected",
      },
    ]);
    mem.seed("cabinetMembers", [
      { _id: "old-cabinet", countryId: "CS" },
      { _id: "foreign-cabinet", countryId: "PL" },
    ]);
    mem.seed("pmAppointmentVotes", [
      { _id: "active", countryId: "CS", status: "active" },
      { _id: "past", countryId: "CS", status: "passed" },
    ]);
    mem.seed("noConfidenceVotes", [{ _id: "active", countryId: "CS", status: "active" }]);
    mem.seed("electionCandidates", [
      { _id: "active", electionId: "future", status: "active" },
      { _id: "past", electionId: "past", status: "active" },
    ]);
    const db = mem as unknown as Db;
    expect(
      await materializeFederationFederalRetirement({
        db,
        session: { inTransaction: () => true } as ClientSession,
        applicationId: "1991-default:cs-1991-default:1",
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
      mem.collection("npps").docs.find((row) => row._id === "old-npp")?.currentOffice
    ).toBeNull();
    expect(
      mem.collection("npps").docs.find((row) => row._id === "foreign-npp")?.currentOffice
    ).toEqual({ type: "sejmDeputy" });
    expect(mem.collection("characters").docs[0]).toMatchObject({
      cash: 50,
      federationPendingResidenceId: "protected",
      currentOffice: null,
    });
    expect(mem.collection("cabinetMembers").docs.map((row) => row._id)).toEqual([
      "foreign-cabinet",
    ]);
    expect(mem.collection("pmAppointmentVotes").docs.map((row) => row.status)).toEqual([
      "cancelled",
      "passed",
    ]);
    expect(mem.collection("noConfidenceVotes").docs[0].status).toBe("cancelled");
    expect(mem.collection("electionCandidates").docs.map((row) => row.status)).toEqual([
      "withdrawn",
      "active",
    ]);
    expect(mem.collection("governmentFormations").docs[0]).toMatchObject({
      status: "collapsed",
      hosName: null,
      pmName: null,
      coalitionPartyIds: null,
      totalSeats: 0,
      activeVoteId: null,
    });
    expect(mem.collection("federationArchivedPoliticalRows").docs).toHaveLength(3);
    expect(
      mem.collection("federationArchivedPoliticalRows").docs.find((row) => row.value._id === "CS")
        ?.value
    ).toMatchObject({ pmName: "Old PM", hosName: "Old head" });
    expect(
      await db.collection<Document & { _id: string }>("countryGameStates").findOne({ _id: "CS" })
    ).toMatchObject({ dissolvedTurn: 97 });
  });
});

it("refuses retirement outside an active transaction without touching the database", async () => {
  const mem = createInMemoryDb();
  await expect(
    materializeFederationFederalRetirement({
      db: mem as unknown as Db,
      session: { inTransaction: () => false } as ClientSession,
      applicationId: "application",
      sourceCountryId: "CS",
      appliedOnTurn: 97,
      now: new Date(0),
    })
  ).rejects.toThrow("transaction");
});
