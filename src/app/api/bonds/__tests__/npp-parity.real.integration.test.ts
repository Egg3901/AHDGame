import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Document, MongoClient, ObjectId, type Db } from "mongodb";
import type { AuthUser } from "@/lib/auth";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

type StringIdDocument = Document & { _id: string };

const uri = process.env.NPP_PARITY_URI;

function validatedDbName(raw: string | undefined): string {
  const match = raw?.match(
    /^mongodb:\/\/127\.0\.0\.1:27018\/(ahd_test_npp_bond_parity_[A-Za-z0-9][A-Za-z0-9_-]*)$/
  );
  if (!match) {
    throw new Error(
      "NPP_PARITY_URI must be an exact localhost:27018 URI with an owned unique database name"
    );
  }
  return match[1];
}

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  clearAuthCookie: vi.fn(),
}));

describe.skipIf(!uri)("player/NPP bond settlement parity (real Mongo)", () => {
  let client: MongoClient | undefined;
  let db: Db;
  const userId = new ObjectId();
  const characterId = new ObjectId();
  const issuerId = new ObjectId();
  const playerBondId = new ObjectId();
  const nppBondId = new ObjectId();
  const nppId = new ObjectId();
  const units = 3;
  const turn = 64;

  beforeAll(async () => {
    const dbName = validatedDbName(uri);
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(dbName);
    expect((await db.listCollections().toArray()).length).toBe(0);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: userId.toString(),
      username: "real-parity",
      email: "real-parity@example.test",
      role: "player",
      isAdmin: false,
    } satisfies AuthUser);

    await db.collection<StringIdDocument>("gameConfig").insertOne({
      _id: "default",
      ledgerShadow: true,
      turnLengthMinutes: 60,
    });
    await db.collection<StringIdDocument>("systemSettings").insertOne({ _id: "current" });
    await db.collection<Document>("exchangeRates").insertOne({ currencyCode: "USD", rate: 2 });
    await db.collection<StringIdDocument>("gameState").insertOne({
      _id: "current",
      currentTurn: turn,
      corporationActionsPaused: false,
      isProcessing: false,
    });
    await db.collection("users").insertOne({ _id: userId, activeCharacterId: characterId });
    await db.collection("characters").insertOne({
      _id: characterId,
      userId,
      name: "Real parity player",
      currencyBalances: { personal: { USD: 10_000 } },
    });
    await db.collection("corporations").insertOne({ _id: issuerId, name: "Parity issuer" });
    await db.collection("npps").insertOne({
      _id: nppId,
      countryId: "US" as CountryId,
      nppInvestmentCashAnchor: 5_000,
    });
    const makeBond = (_id: ObjectId) => ({
      _id,
      countryId: "US" as CountryId,
      corporationId: issuerId,
      issuerName: "Parity issuer",
      issuerType: "sovereign",
      currencyCode: "USD" as CurrencyCode,
      faceValue: 1000,
      marketPrice: 0.9,
      publicFloat: 10,
      holders: [],
      maturityTurn: turn + 20,
      matured: false,
      defaulted: false,
    });
    await db.collection("bonds").insertMany([makeBond(playerBondId), makeBond(nppBondId)]);
    await db.collection<StringIdDocument>("bondMarketPools").insertOne({
      _id: "USD",
      cashLocal: 1_000_000,
      targetCashLocal: 0,
    });
  });

  afterAll(async () => {
    await client?.close();
  });

  it("runs the real player route and NPP core with equal units, home currency, and FX rate", async () => {
    const { POST } = await import("../[bondId]/buy/route");
    const playerResponse = await POST(
      new Request(`http://test.local/api/bonds/${playerBondId}/buy`, {
        method: "POST",
        body: JSON.stringify({ units }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ bondId: playerBondId.toString() }) }
    );
    expect(playerResponse.status).toBe(200);
    const playerBody = (await playerResponse.json()) as { cost: number };

    const { nppBuyBond } = await import("@/lib/nppAutonomy/v3/finance/nppBonds");
    const nppResult = await nppBuyBond(
      db,
      { _id: nppId, countryId: "US" as CountryId },
      nppBondId,
      units,
      turn,
      2
    );
    expect(nppResult).toMatchObject({
      ok: true,
      units,
      cost: playerBody.cost,
      costAnchor: playerBody.cost / 2,
    });

    const playerBond = await db.collection("bonds").findOne({ _id: playerBondId });
    const nppBond = await db.collection("bonds").findOne({ _id: nppBondId });
    expect(playerBond?.publicFloat).toBe(7);
    expect(nppBond?.publicFloat).toBe(7);
    expect(playerBond?.holders[0]).toMatchObject({ characterId, units });
    expect(nppBond?.holders[0]).toMatchObject({ nppId, units });
    expect(
      (await db.collection("characters").findOne({ _id: characterId }))!.currencyBalances.personal
        .USD
    ).toBe(10_000 - playerBody.cost);
    expect((await db.collection("npps").findOne({ _id: nppId }))!.nppInvestmentCashAnchor).toBe(
      5_000 - playerBody.cost / 2
    );
    expect(
      (await db.collection<StringIdDocument>("bondMarketPools").findOne({ _id: "USD" }))!.cashLocal
    ).toBe(1_000_000 + playerBody.cost * 2);

    const txs = await db.collection("financialTxLog").find({ type: "bond_purchase" }).toArray();
    expect(txs.map((tx) => tx.subjectType).sort()).toEqual(["character", "npp"]);
    const entries = await db
      .collection("ledgerEntries")
      .find({ txType: "bond_purchase" })
      .toArray();
    expect(entries).toHaveLength(2);
    expect(
      entries.every(
        (entry) =>
          Math.abs(
            entry.legs.reduce(
              (sum: number, leg: { anchorAmount: number }) => sum + leg.anchorAmount,
              0
            )
          ) < 1e-8
      )
    ).toBe(true);
  });
});
