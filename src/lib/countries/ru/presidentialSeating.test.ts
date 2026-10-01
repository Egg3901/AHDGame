import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianPresidentialSeating as seat } from "./presidentialSeating";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const electionId = new ObjectId();
  const president = new ObjectId(),
    vice = new ObjectId(),
    oldChair = new ObjectId();
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruPresidencyMandateSinceTurn: 72,
      ruPresidencyCertifiedElectionId: electionId,
      ruPresidencyElectionCertifiedSinceTurn: 84,
    },
  ]);
  mem.seed("russianPresidentialElectionResults", [
    {
      _id: electionId.toHexString(),
      electionId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 72,
      resolvedOnTurn: 84,
      decision: { outcome: "won", winnerCandidateId: new ObjectId().toHexString() },
      winner: { characterId: president, name: "Winner", party: "1" },
      vicePresident: { nppId: vice, name: "Vice", party: "2" },
    },
  ]);
  mem.seed("characters", [
    { _id: president, countryId: "RU", money: 500, currentOffice: { type: "congressDeputy" } },
  ]);
  mem.seed("npps", [
    { _id: vice, countryId: "RU", currentOffice: null },
    {
      _id: oldChair,
      countryId: "RU",
      currentOffice: { type: "chairmanOfSupremeSoviet" },
      money: 100,
    },
  ]);
  mem.seed("electedOfficials", [
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "chairmanOfSupremeSoviet",
      nppId: oldChair,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "congressDeputy",
      characterId: president,
      seatsHeld: 1,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "congressDeputy",
      nppId: new ObjectId(),
      seatsHeld: 10,
    },
  ]);
  mem.seed("governmentFormations", [
    {
      _id: "RU",
      status: "formed",
      pmNppId: new ObjectId(),
      pmName: "Continuing PM",
      hosNppId: oldChair,
    },
  ]);
  mem.seed("electionCandidates", [
    { _id: new ObjectId(), countryId: "RU", characterId: president, status: "active" },
  ]);
  return {
    mem,
    president,
    vice,
    input: {
      db: mem as unknown as Db,
      session,
      turn: 85,
      now: new Date(1000),
      officialIds: [new ObjectId(), new ObjectId()] as [ObjectId, ObjectId],
    },
  };
}
describe("Russian certified presidential office handover", () => {
  it("seats the ticket, archives the Chairman and preserves Congress and its PM", async () => {
    const { mem, president, vice, input } = scenario();
    expect(await seat(input)).toBe(true);
    expect(mem.collection("characters").docs[0]).toMatchObject({
      money: 500,
      currentOffice: { type: "president" },
    });
    expect(
      mem.collection("npps").docs.find((p) => (p._id as ObjectId).equals(vice))?.currentOffice
    ).toEqual({ type: "vicePresident" });
    expect(mem.collection("npps").docs[1]).toMatchObject({ money: 100, currentOffice: null });
    const rows = mem.collection("electedOfficials").docs;
    expect(rows.some((r) => r.officeType === "chairmanOfSupremeSoviet")).toBe(false);
    expect(rows.find((r) => r.officeType === "president")?.characterId).toEqual(president);
    expect(rows.filter((r) => r.officeType === "congressDeputy")).toHaveLength(2);
    expect(
      rows.find((r) => r.officeType === "congressDeputy" && r.characterId === null)?.seatsHeld
    ).toBeUndefined();
    expect(mem.collection("governmentFormations").docs[0]).toMatchObject({
      status: "formed",
      pmName: "Continuing PM",
      hosCharacterId: president,
      hosNppId: null,
    });
    expect(mem.collection("russianPresidentialOfficeArchives").docs).toHaveLength(2);
    expect(mem.collection("countryGameStates").docs[0].ruPresidencySinceTurn).toBe(85);
    expect(mem.collection("electionCandidates").docs[0].status).toBe("withdrawn");
    expect(await seat({ ...input, turn: 86 })).toBe(false);
    expect(rows.filter((r) => r.officeType === "president")).toHaveLength(1);
  });
  it("keeps existing offices until a bound ticket is certified", async () => {
    const { mem, input } = scenario();
    delete mem.collection("countryGameStates").docs[0].ruPresidencyCertifiedElectionId;
    expect(await seat(input)).toBe(false);
    expect(mem.collection("electedOfficials").docs).toHaveLength(3);
    expect(mem.collection("russianPresidentialOfficeArchives").docs).toHaveLength(0);
  });
  it("rejects a stale mandate, moved ticket or nontransactional handover before writes", async () => {
    const { mem, input } = scenario();
    await expect(
      seat({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
    mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn = 73;
    await expect(seat(input)).rejects.toThrow("current certified");
    mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn = 72;
    mem.collection("characters").docs[0].countryId = "US";
    await expect(seat(input)).rejects.toThrow("no longer resident");
    expect(mem.collection("electedOfficials").docs).toHaveLength(3);
  });
  it("reopens PM appointment only when the PM joins the winning ticket", async () => {
    const { mem, president, input } = scenario();
    mem.collection("governmentFormations").docs[0].pmCharacterId = president;
    await seat(input);
    expect(mem.collection("governmentFormations").docs[0]).toMatchObject({
      status: "pending",
      pmCharacterId: null,
      pmNppId: null,
      pmName: null,
    });
  });
});
