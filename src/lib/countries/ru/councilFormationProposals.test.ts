import { ObjectId, type ClientSession, type Db } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  materializeRussianCouncilFormationProposal as open,
  authorizeRussianCouncilFormation as authorize,
  loadRussianCouncilFormationDecisions as decisions,
} from "./councilFormationProposals";
const session = { inTransaction: () => true } as ClientSession;
describe("enacted Council formation proposals", () => {
  let mem: ReturnType<typeof createInMemoryDb>, db: Db;
  const base = { session, game: { preset: "1991-default" }, turn: 237, now: new Date(1000) };
  beforeEach(() => {
    mem = createInMemoryDb();
    db = mem as unknown as Db;
    mem.seed("countryGameStates", [{ _id: "RU", ruFederalAssemblySinceTurn: 145 }]);
  });
  it("opens one bound ordinary law without installing any Council or authority", async () => {
    const input = { ...base, db, mode: "regionalHeads" as const, sponsor: null };
    const proposal = await open(input);
    expect(await open(input)).toEqual(proposal);
    expect(mem.collection("bills").docs).toHaveLength(1);
    expect(mem.collection("bills").docs[0]).toMatchObject({
      originChamber: "stateDuma",
      status: "proposed",
      russianCouncilFormationMandate: { mode: "regionalHeads", revision: 1 },
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruCouncilFormationMandate"
    );
    expect(mem.collection("electedOfficials").docs).toHaveLength(0);
    expect(
      (await decisions(db, base.game, 237)).find((row) => row.kind === "regionalHeads")
    ).toMatchObject({ threshold: "majority", seatCapacity: 450, proposal: { canRevise: false } });
  });
  it.each(["early", "unseated", "other-era"])("rejects %s proposed formation", async (kind) => {
    if (kind === "unseated")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = undefined;
    await expect(
      open({
        ...base,
        db,
        turn: kind === "early" ? 236 : 237,
        game: { preset: kind === "other-era" ? "1953-default" : "1991-default" },
        mode: "regionalHeads",
        sponsor: null,
      })
    ).rejects.toThrow();
    expect(mem.collection("bills").docs).toHaveLength(0);
  });
  it("authorizes only a signed bound law and keeps physical handover separate", async () => {
    const proposal = await open({ ...base, db, mode: "regionalHeads", sponsor: null });
    const input = { ...base, db, proposalId: proposal._id };
    expect(await authorize(input)).toBe(false);
    const bill = mem.collection("bills").docs[0];
    Object.assign(bill, { status: "signed", enactedAt: base.now });
    expect(await authorize(input)).toBe(true);
    expect(mem.collection("countryGameStates").docs[0]).toMatchObject({
      ruCouncilFormationMandate: {
        mode: "regionalHeads",
        proposalId: proposal._id,
        revision: 1,
        sinceTurn: 237,
      },
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruCouncilComposition");
    expect(await authorize(input)).toBe(false);
  });
  it("rejects changed enacted revisions and revises a failed bill only by an explicit new proposal", async () => {
    const input = { ...base, db, mode: "regionalHeads" as const, sponsor: null };
    const old = await open(input);
    const bill = mem.collection("bills").docs[0];
    Object.assign(bill, {
      status: "signed",
      enactedAt: base.now,
      russianCouncilFormationMandate: { proposalId: old._id, mode: "regionalHeads", revision: 2 },
    });
    await expect(authorize({ ...base, db, proposalId: old._id })).rejects.toThrow("does not match");
    bill.russianCouncilFormationMandate = {
      proposalId: old._id,
      mode: "regionalHeads",
      revision: 1,
    };
    bill.status = "failed";
    const next = await open({ ...input, newBillId: new ObjectId() });
    expect(next.revision).toBe(2);
    expect(next.billId.equals(old.billId)).toBe(false);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruCouncilFormationMandate"
    );
  });
  it("can adopt separate delegates later while preserving the previous installed chamber until handover", async () => {
    const country = mem.collection("countryGameStates").docs[0];
    country.ruCouncilFormationMandate = {
      mode: "regionalHeads",
      proposalId: "heads",
      revision: 1,
      sinceTurn: 237,
    };
    country.ruCouncilComposition = {
      mode: "regionalHeads",
      proposalId: "heads",
      revision: 1,
      sinceTurn: 241,
      receiptId: "old",
    };
    const proposal = await open({
      ...base,
      db,
      turn: 461,
      mode: "regionalDelegates",
      sponsor: null,
    });
    Object.assign(mem.collection("bills").docs[0], { status: "signed", enactedAt: base.now });
    expect(await authorize({ ...base, db, turn: 461, proposalId: proposal._id })).toBe(true);
    expect(country.ruCouncilComposition).toMatchObject({ mode: "regionalHeads", receiptId: "old" });
    expect(country.ruCouncilFormationMandate).toMatchObject({
      mode: "regionalDelegates",
      sinceTurn: 461,
    });
  });
});
