import { describe, expect, it, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { chargeOrgBuildFunds } from "./chargeOrgBuildFunds";

// Cash side of Build Org. The PS debit lives in `spendPoliticalStrength`; this
// command moves the money and writes the audit row.

const NOW = new Date("2026-09-02T12:00:00Z");

function seed() {
  const db = createInMemoryDb();
  db.collection("statePartyOrg").insertOne({
    _id: "US_CA_1",
    countryId: "US",
    stateId: "CA",
    partyId: "1",
    treasury: 500_000,
  });
  db.collection("politicalParties").insertOne({
    _id: new ObjectId(),
    countryId: "US",
    sequentialId: 1,
    treasury: 8_000_000,
  });
  return db;
}

describe("chargeOrgBuildFunds", () => {
  let db: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    db = seed();
  });

  it("debits the STATE party treasury for a state-scope click", async () => {
    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 20_000,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(20_000);
    const row = await db.collection("statePartyOrg").findOne({ _id: "US_CA_1" });
    expect(row?.treasury).toBe(480_000);
  });

  it("debits the NATIONAL party treasury for a national-targeted click", async () => {
    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "national-targeted",
        stateRowId: "US_CA_1",
        amount: 45_000,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(45_000);
    const party = await db.collection("politicalParties").findOne({ sequentialId: 1 });
    expect(party?.treasury).toBe(7_955_000);
    // The state row is untouched — national scope pays from the national pool.
    const row = await db.collection("statePartyOrg").findOne({ _id: "US_CA_1" });
    expect(row?.treasury).toBe(500_000);
  });

  it("never overdraws when a concurrent debit drained the treasury first", async () => {
    await db
      .collection("statePartyOrg")
      .updateOne({ _id: "US_CA_1" }, { $set: { treasury: 12_000 } });

    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 20_000,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(12_000);
    const row = await db.collection("statePartyOrg").findOne({ _id: "US_CA_1" });
    expect(row?.treasury).toBe(0);
  });

  it("charges nothing against an already-overdrawn treasury rather than deepening it", async () => {
    await db
      .collection("statePartyOrg")
      .updateOne({ _id: "US_CA_1" }, { $set: { treasury: -75_000 } });

    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 20_000,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(0);
    const row = await db.collection("statePartyOrg").findOne({ _id: "US_CA_1" });
    expect(row?.treasury).toBe(-75_000);
  });

  it("writes an org_building debit to the treasury audit log", async () => {
    await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 20_000,
        memo: "Build Org (CA)",
        initiatedBy: { type: "character", id: "abc", label: "Ariane Yeong" },
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    const txns = await db.collection("treasuryTransactions").find({}).toArray();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      holderType: "state_party",
      holderId: "US_CA_1",
      partyId: "1",
      countryId: "US",
      category: "org_building",
      direction: "debit",
      amount: 20_000,
      turn: 500,
    });
    expect(txns[0].initiatedBy).toMatchObject({ type: "character", id: "abc" });
  });

  it("logs the amount ACTUALLY charged, not the amount requested", async () => {
    await db
      .collection("statePartyOrg")
      .updateOne({ _id: "US_CA_1" }, { $set: { treasury: 12_000 } });

    await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 20_000,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    const txns = await db.collection("treasuryTransactions").find({}).toArray();
    expect(txns[0]?.amount).toBe(12_000);
  });

  it("writes no audit row for a zero charge", async () => {
    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_CA_1",
        amount: 0,
        memo: "Build Org (CA)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(0);
    expect(await db.collection("treasuryTransactions").countDocuments({})).toBe(0);
    const row = await db.collection("statePartyOrg").findOne({ _id: "US_CA_1" });
    expect(row?.treasury).toBe(500_000);
  });

  it("charges nothing when the target row is missing", async () => {
    const result = await chargeOrgBuildFunds(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateRowId: "US_ZZ_1",
        amount: 20_000,
        memo: "Build Org (ZZ)",
        turn: 500,
        now: NOW,
      },
      db as unknown as Db
    );

    expect(result.charged).toBe(0);
    expect(await db.collection("treasuryTransactions").countDocuments({})).toBe(0);
  });
});
