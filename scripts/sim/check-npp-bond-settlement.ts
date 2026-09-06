/**
 * Real-Mongo smoke fixture for player/NPP sovereign-bond settlement parity.
 *
 * Deliberately requires an explicitly named localhost:27018 database. It never
 * drops data; each invocation uses a fresh database name and exits if it is
 * already present. Run with `NPP_PARITY_URI` set to the unique sandbox URI.
 */
import { Document, MongoClient, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

type StringIdDocument = Document & { _id: string };

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function main(): Promise<void> {
  const uri = process.env.NPP_PARITY_URI;
  const match = uri?.match(
    /^mongodb:\/\/127\.0\.0\.1:27018\/(ahd_test_npp_bond_parity_[0-9]{8}_[0-9]+)$/
  );
  if (!match)
    fail("NPP_PARITY_URI must be an exact localhost:27018 URI with a unique owned database");
  const dbName = match[1];
  // The ledger feature flag resolves through the normal application DB helper.
  // Point that helper at this same explicitly validated sandbox before loading
  // any domain modules.
  process.env.MONGODB_URI = uri;

  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const db = client.db(dbName);
    assert((await db.listCollections().toArray()).length === 0, `database ${dbName} is not empty`);

    const now = new Date("2026-09-06T00:00:00.000Z");
    const turn = 64;
    const playerId = new ObjectId();
    const nppId = new ObjectId();
    const playerBondId = new ObjectId();
    const nppBondId = new ObjectId();
    const units = 3;
    const marketPrice = 0.9;
    const initialPlayerCash = 10_000;
    const initialNppCashAnchor = 5_000;

    await db
      .collection<StringIdDocument>("gameConfig")
      .insertOne({ _id: "default", ledgerShadow: true, turnLengthMinutes: 60 });
    await db.collection<StringIdDocument>("systemSettings").insertOne({ _id: "current" });
    await db.collection<Document>("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });
    await db.collection<Document>("characters").insertOne({
      _id: playerId,
      name: "Parity player",
      userId: new ObjectId(),
      currencyBalances: { personal: { USD: initialPlayerCash } },
    });
    await db.collection<Document>("npps").insertOne({
      _id: nppId,
      countryId: "US" as CountryId,
      nppInvestmentCashAnchor: initialNppCashAnchor,
    });
    const bond = (id: ObjectId) => ({
      _id: id,
      countryId: "US" as CountryId,
      currencyCode: "USD" as CurrencyCode,
      issuerName: "Parity Treasury",
      issuerType: "sovereign" as const,
      faceValue: 1000,
      marketPrice,
      publicFloat: 10,
      holders: [],
      maturityTurn: turn + 20,
      matured: false,
      defaulted: false,
    });
    await db.collection<Document>("bonds").insertMany([bond(playerBondId), bond(nppBondId)]);

    const { atomicallyDebitCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");
    const { reserveBondUnitsForHolder } = await import("@/lib/bonds/bondHolderOps");
    const { creditBondPool } = await import("@/lib/bonds/marketPool");
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const { nppBuyBond } = await import("@/lib/nppAutonomy/v3/finance/nppBonds");
    const { loadBondQuote } = await import("@/lib/bonds/marketPool");
    const cost = units * (await loadBondQuote(db, bond(playerBondId))).askPerUnit;

    // This is the same persisted character settlement sequence as the route:
    // guarded debit, holder reservation, pool credit, and financial tx emit.
    const playerDebit = await atomicallyDebitCharacterCash(db, playerId, "USD", cost, true);
    assert(playerDebit.ok, "player debit failed");
    const playerReserved = await reserveBondUnitsForHolder(
      db,
      playerBondId,
      { field: "characterId", id: playerId },
      units,
      now
    );
    assert(playerReserved, "player bond reservation failed");
    await creditBondPool(db, "USD", cost, "purchasesIn", now);
    await emitTx(db, {
      type: "bond_purchase",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: playerId,
      subjectName: "Parity player",
      amount: -cost,
      balanceAfter: playerDebit.newBalance,
      currencyCode: "USD",
      counterpartyType: "system",
      counterpartyName: "Parity Treasury",
      meta: { bondId: playerBondId.toString(), units, pricePerUnit: marketPrice },
    });

    // NPP uses a non-unit home FX rate to prove local cash and anchor debit are
    // distinct while the bond and pool remain denominated in matching USD.
    const nppResult = await nppBuyBond(
      db,
      { _id: nppId, countryId: "US" },
      nppBondId,
      units,
      turn,
      2
    );
    if (!nppResult.ok) fail(nppResult.reason);
    assert(nppResult.cost === cost, "NPP local cost mismatch");
    assert(nppResult.costAnchor === cost / 2, "NPP anchor conversion mismatch");

    const player = await db.collection("characters").findOne({ _id: playerId });
    const npp = await db.collection("npps").findOne({ _id: nppId });
    assert(
      player?.currencyBalances?.personal?.USD === initialPlayerCash - cost,
      "player cash conservation failed"
    );
    assert(
      npp?.nppInvestmentCashAnchor === initialNppCashAnchor - cost / 2,
      "NPP anchor cash conservation failed"
    );
    for (const id of [playerBondId, nppBondId]) {
      const doc = await db.collection("bonds").findOne({ _id: id });
      assert(doc?.publicFloat === 10 - units, `float conservation failed for ${id}`);
      assert(doc?.holders?.[0]?.units === units, `holder conservation failed for ${id}`);
    }
    const pool = await db.collection<StringIdDocument>("bondMarketPools").findOne({ _id: "USD" });
    assert(pool?.cashLocal === cost * 2, "bond pool conservation failed");
    const txs = await db.collection("financialTxLog").find({ type: "bond_purchase" }).toArray();
    assert(txs.length === 2, "both player and NPP financial transactions must persist");
    assert(
      txs.some((tx) => tx.subjectType === "npp" && tx.subjectId?.equals(nppId)),
      "NPP tx missing"
    );
    const ledger = await db.collection("ledgerEntries").find({ txType: "bond_purchase" }).toArray();
    assert(
      ledger.length === 2 && ledger.every((entry) => entry.balanced),
      "ledger entries unbalanced or missing"
    );

    // A failed NPP reservation must refund the guarded debit and leave no new
    // settlement side effects. The zero-float bond makes this race-free.
    const failedBondId = new ObjectId();
    await db.collection("bonds").insertOne({ ...bond(failedBondId), publicFloat: 0 });
    const before = (await db.collection("npps").findOne({ _id: nppId }))!.nppInvestmentCashAnchor;
    const failed = await nppBuyBond(
      db,
      { _id: nppId, countryId: "US" },
      failedBondId,
      units,
      turn,
      2
    );
    assert(!failed.ok, "zero-float NPP purchase unexpectedly succeeded");
    const after = (await db.collection("npps").findOne({ _id: nppId }))!.nppInvestmentCashAnchor;
    assert(before === after, "failed NPP purchase did not refund investment cash");
    assert(
      (await db.collection("financialTxLog").countDocuments({ subjectType: "npp" })) === 1,
      "failed NPP emitted a tx"
    );

    console.log(
      JSON.stringify(
        {
          dbName,
          turn,
          units,
          localCost: cost,
          nppCostAnchor: cost / 2,
          playerTxs: 1,
          nppTxs: 1,
          balancedLedgerEntries: 2,
        },
        null,
        2
      )
    );
  } finally {
    if (connected) await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
