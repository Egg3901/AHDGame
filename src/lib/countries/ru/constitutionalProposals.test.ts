import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  materializeRussianConstitutionalProposal,
  authorizeRussianConstitutionalMandate,
} from "./constitutionalProposals";
const session = { inTransaction: () => true } as ClientSession;
const game = { preset: "1991-default" };
const now = new Date(1000);
function scenario() {
  const mem = createInMemoryDb();
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruProvisionalCongressSeats: 1154 },
  ]);
  return { mem, db: mem as unknown as Db };
}
describe("Russian constitutional proposal transactions", () => {
  it("opens separate ordinary bills and reuses each pending choice", async () => {
    const { mem, db } = scenario();
    const sponsor = { _id: new ObjectId(), name: "Deputy" };
    const presidency = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 129,
      now,
      kind: "presidency",
      sponsor,
    });
    const assembly = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 129,
      now,
      kind: "federalAssembly",
      sponsor,
    });
    expect(presidency.billId.equals(assembly.billId)).toBe(false);
    expect(
      await materializeRussianConstitutionalProposal({
        db,
        session,
        game,
        turn: 130,
        now,
        kind: "presidency",
        sponsor,
      })
    ).toEqual(presidency);
    expect(await mem.collection("bills").countDocuments()).toBe(2);
    expect(await mem.collection("bills").findOne({ _id: assembly.billId })).toMatchObject({
      countryId: "RU",
      status: "proposed",
      currentChamber: "congressOfPeoplesDeputies",
      sponsorId: sponsor._id,
      russianConstitutionalMandate: { kind: "federalAssembly", revision: 1 },
    });
    expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).not.toHaveProperty(
      "ruCongressDissolvedSinceTurn"
    );
  });
  it("keeps rejection meaningful and permits a fresh recorded revision", async () => {
    const { db, mem } = scenario();
    const first = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 129,
      now,
      kind: "presidency",
      sponsor: null,
    });
    await mem.collection("bills").updateOne({ _id: first.billId }, { $set: { status: "failed" } });
    const revised = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 130,
      now,
      kind: "presidency",
      sponsor: null,
    });
    expect(revised.revision).toBe(2);
    expect(revised.billId.equals(first.billId)).toBe(false);
    expect(
      await authorizeRussianConstitutionalMandate({
        db,
        session,
        game,
        turn: 130,
        now,
        proposalId: revised._id,
      })
    ).toBe(false);
  });
  it("authorizes only the bound signed decision and leaves inauguration and elections pending", async () => {
    const { db, mem } = scenario();
    const proposal = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 129,
      now,
      kind: "federalAssembly",
      sponsor: null,
    });
    const apply = () =>
      authorizeRussianConstitutionalMandate({
        db,
        session,
        game,
        turn: 130,
        now,
        proposalId: proposal._id,
      });
    await mem
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "veto_override", enactedAt: now } });
    expect(await apply()).toBe(false);
    await mem
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: null } });
    expect(await apply()).toBe(false);
    await mem
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: now } });
    expect(await apply()).toBe(true);
    expect(await apply()).toBe(false);
    const country = await mem.collection("countryGameStates").findOne({ _id: "RU" });
    expect(country).toHaveProperty("ruFederalAssemblyMandateSinceTurn", 130);
    for (const marker of [
      "ruPresidencyMandateSinceTurn",
      "ruPresidencySinceTurn",
      "ruCongressDissolvedSinceTurn",
      "ruFederalAssemblySinceTurn",
      "ruFederalAssemblyElectionCertifiedSinceTurn",
    ])
      expect(country).not.toHaveProperty(marker);
  });
  it("rejects a mismatched revision without authorizing it", async () => {
    const { db, mem } = scenario();
    const proposal = await materializeRussianConstitutionalProposal({
      db,
      session,
      game,
      turn: 129,
      now,
      kind: "presidency",
      sponsor: null,
    });
    await mem
      .collection("bills")
      .updateOne(
        { _id: proposal.billId },
        { $set: { status: "signed", enactedAt: now, "russianConstitutionalMandate.revision": 2 } }
      );
    await expect(
      authorizeRussianConstitutionalMandate({
        db,
        session,
        game,
        turn: 130,
        now,
        proposalId: proposal._id,
      })
    ).rejects.toThrow("match");
    expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).not.toHaveProperty(
      "ruPresidencyMandateSinceTurn"
    );
  });
  it("rejects premature, founding-phase and unratified proposals", async () => {
    const { db, mem } = scenario();
    await expect(
      materializeRussianConstitutionalProposal({
        db,
        session,
        game,
        turn: 128,
        now,
        kind: "federalAssembly",
        sponsor: null,
      })
    ).rejects.toThrow("before-date");
    await expect(
      materializeRussianConstitutionalProposal({
        db,
        session,
        game: { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        turn: 160,
        now,
        kind: "presidency",
        sponsor: null,
      })
    ).rejects.toThrow("before-date");
    await mem
      .collection("countryGameStates")
      .updateOne({ _id: "RU" }, { $unset: { ruSovietSuccessionSinceTurn: "" } });
    await expect(
      materializeRussianConstitutionalProposal({
        db,
        session,
        game,
        turn: 160,
        now,
        kind: "presidency",
        sponsor: null,
      })
    ).rejects.toThrow("awaiting-succession");
    expect(await mem.collection("bills").countDocuments()).toBe(0);
  });
  it("requires active transactions for both proposal and authorization", async () => {
    const { db } = scenario();
    const inactive = { inTransaction: () => false } as ClientSession;
    await expect(
      materializeRussianConstitutionalProposal({
        db,
        session: inactive,
        game,
        turn: 129,
        now,
        kind: "presidency",
        sponsor: null,
      })
    ).rejects.toThrow("transaction");
    await expect(
      authorizeRussianConstitutionalMandate({
        db,
        session: inactive,
        game,
        turn: 129,
        now,
        proposalId: "x",
      })
    ).rejects.toThrow("transaction");
  });
});
