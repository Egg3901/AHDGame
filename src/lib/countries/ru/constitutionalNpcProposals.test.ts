import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: (body: (session: ClientSession) => Promise<unknown>) =>
    body({ inTransaction: () => true } as ClientSession),
}));
import { processRussianConstitutionalNpcProposals } from "./constitutionalNpcProposals";
const game = { preset: "1991-default" };
function scenario() {
  const mem = createInMemoryDb();
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruProvisionalCongressSeats: 1154 },
  ]);
  mem.seed("governmentFormations", [{ _id: "RU", status: "formed", pmNppId: new ObjectId() }]);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy", nppId: new ObjectId() },
  ]);
  return { mem, db: mem as unknown as Db };
}
describe("NPC Russian constitutional introduction", () => {
  it("opens each eligible decision only once without granting authority", async () => {
    const { db, mem } = scenario();
    expect(await processRussianConstitutionalNpcProposals(db, game, 128, new Date(0))).toBe(1);
    expect(await processRussianConstitutionalNpcProposals(db, game, 129, new Date(0))).toBe(1);
    expect(await processRussianConstitutionalNpcProposals(db, game, 130, new Date(0))).toBe(0);
    expect(mem.collection("bills").docs).toHaveLength(2);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruPresidencyMandateSinceTurn"
    );
    await mem.collection("bills").updateMany({}, { $set: { status: "failed" } });
    expect(await processRussianConstitutionalNpcProposals(db, game, 131, new Date(0))).toBe(0);
  });
  it.each(["government", "legislature"])(
    "leaves player-held %s decisions to players",
    async (holder) => {
      const { db, mem } = scenario();
      if (holder === "government")
        mem.collection("governmentFormations").docs[0].pmCharacterId = new ObjectId();
      else mem.collection("electedOfficials").docs[0].characterId = new ObjectId();
      expect(await processRussianConstitutionalNpcProposals(db, game, 129, new Date(0))).toBe(0);
      expect(mem.collection("bills").docs).toHaveLength(0);
    }
  );
  it("waits for a seated formed government and active successor legislature", async () => {
    const { db, mem } = scenario();
    mem.collection("governmentFormations").docs[0].status = "pending";
    expect(await processRussianConstitutionalNpcProposals(db, game, 129, new Date(0))).toBe(0);
    mem.collection("governmentFormations").docs[0].status = "formed";
    mem.collection("electedOfficials").docs[0].officeType = "unionCongressDeputy";
    expect(await processRussianConstitutionalNpcProposals(db, game, 129, new Date(0))).toBe(0);
  });
});
