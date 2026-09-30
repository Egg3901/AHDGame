/** Focused real fund-phase continuation of a completed sandbox, never a full-world run. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { MongoClient, ObjectId, BSON, type Db } from "mongodb";
import type { IndexFund, Corporation, Bond, ExchangeRate } from "../../src/lib/db/types";

const arg = (key: string) => process.argv.find((v) => v.startsWith(`--${key}=`))?.split("=")[1];
const sourceName = arg("source");
const targetName = arg("target");
const uri = process.env.SIM_MONGODB_URI;
assert(uri && sourceName && targetName && sourceName !== targetName);
assert([sourceName, targetName].every((name) => /^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name)));
const endpoint = new URL(uri);
assert(endpoint.protocol === "mongodb:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname));
assert(endpoint.port === "27018" && endpoint.pathname === "/");
Object.assign(process.env, { NODE_ENV: "test" });
process.env.MONGODB_URI = uri;
process.env.MONGODB_DB = targetName;
process.env.MONGO_DB_NAME = targetName;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function audit(db: Db) {
  const [funds, bonds, corps, rates, orders, queue, positions] = await Promise.all([
    db.collection<IndexFund>("indexFunds").find({}).toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: false, defaulted: { $ne: true } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        {},
        {
          projection: {
            shareholders: 1,
            sharePrice: 1,
            fundamentalSharePrice: 1,
            publicFloat: 1,
            totalShares: 1,
            liquidCurrencyCode: 1,
          },
        }
      )
      .toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    db
      .collection("shareOrders")
      .find({ type: "buy", status: "open", placerFundId: { $exists: true } })
      .toArray(),
    db
      .collection("indexFundRedemptionQueue")
      .find({ units: { $gt: 0 } })
      .toArray(),
    db.collection("indexFundPositions").find({}).toArray(),
  ]);
  const { COUNTRY_CURRENCY_MAP } = await import("../../src/lib/constants/currencies");
  const { BOND_UNIT_FACE_VALUE } = await import("../../src/lib/db/types/bond");
  const { resolveShareExecutionPrice } = await import("../../src/lib/corporations/marketExecution");
  const fx = new Map(rates.map((r) => [r.currencyCode as string, r.rate]));
  const corpMap = new Map(corps.map((c) => [String(c._id), c]));
  const fundIds = new Set(funds.map((f) => String(f._id)));
  const rows = [];
  let missingPrices = 0;
  let orphanHoldings = 0;
  let capTableMismatches = 0;
  for (const fund of funds) {
    let bondValue = 0;
    for (const bond of bonds) {
      const units = bond.holders
        .filter((h) => String(h.fundId) === String(fund._id))
        .reduce((n, h) => n + h.units, 0);
      if (!units) continue;
      const currency =
        bond.currencyCode ?? (bond.countryId ? COUNTRY_CURRENCY_MAP[bond.countryId] : "USD");
      const rate = fx.get(currency);
      assert(
        rate && rate > 0 && Number.isFinite(bond.marketPrice),
        "Bond valuation requires live price and FX"
      );
      bondValue += (units * BOND_UNIT_FACE_VALUE * bond.marketPrice) / rate;
    }
    let equityValue = 0;
    for (const holding of fund.holdings) {
      const corp = corpMap.get(String(holding.corporationId));
      if (!corp) {
        orphanHoldings++;
        continue;
      }
      const capShares = (corp.shareholders ?? [])
        .filter((h) => String(h.fundId) === String(fund._id))
        .reduce((n, h) => n + h.shares, 0);
      if (capShares !== holding.shares) capTableMismatches++;
      if (!(corp.sharePrice > 0) || !Number.isFinite(holding.lastValueAnchor)) missingPrices++;
      const shareRate = corp.liquidCurrencyCode ? fx.get(corp.liquidCurrencyCode) : 1;
      assert(shareRate && shareRate > 0, "Equity valuation requires a live FX quote");
      equityValue += (holding.shares * resolveShareExecutionPrice(corp)) / shareRate;
    }
    const escrow = orders
      .filter((o) => String(o.placerFundId) === String(fund._id))
      .reduce((n, o) => n + (o.escrowAnchor ?? 0), 0);
    const queued = queue
      .filter((q) => String(q.fundId) === String(fund._id) && q.unitsBurnedAtRequest)
      .reduce((n, q) => n + q.units, 0);
    const assets = fund.cashAnchor + equityValue + bondValue + escrow;
    const liability = fund.quotedNav * (fund.unitSupply + queued);
    const allocation = fund.cashAnchor + equityValue + bondValue;
    rows.push({
      slug: fund.slug,
      status: fund.status,
      backing: liability ? assets / liability : 1,
      cashShare: allocation ? fund.cashAnchor / allocation : 0,
      reserveShare: allocation ? (fund.cashAnchor + bondValue) / allocation : 0,
    });
  }
  const orphanPositions = positions.filter(
    (p) => !fundIds.has(String(p.fundId)) || !Number.isInteger(p.units) || p.units <= 0
  ).length;
  const active = rows.filter((r) => r.status === "active");
  return {
    funds: active.length,
    minBacking: Math.min(...active.map((r) => r.backing)),
    minCashShare: Math.min(...active.map((r) => r.cashShare)),
    minReserveShare: Math.min(...active.map((r) => r.reserveShare)),
    missingPrices,
    orphanHoldings,
    orphanPositions,
    capTableMismatches,
    failures: active.filter(
      (r) => r.backing < 1 - 1e-6 || r.cashShare < 0.05 - 1e-6 || r.reserveShare < 0.25 - 1e-6
    ),
  };
}

async function main() {
  const client = await new MongoClient(uri!, { monitorCommands: true }).connect();
  let measuring = false;
  let phaseRoundTrips = 0;
  let phaseReadBytes = 0;
  client.on("commandSucceeded", (event) => {
    if (!measuring) return;
    phaseRoundTrips++;
    const reply = event.reply as {
      cursor?: { firstBatch?: Record<string, unknown>[]; nextBatch?: Record<string, unknown>[] };
    };
    const batches = reply?.cursor?.firstBatch ?? reply?.cursor?.nextBatch ?? [];
    for (const row of batches) phaseReadBytes += BSON.calculateObjectSize(row);
  });
  global._mongoClientPromise = Promise.resolve(client);
  try {
    const source = client.db(sourceName);
    const target = client.db(targetName);
    assert.equal(
      (await target.listCollections({}, { nameOnly: true }).toArray()).length,
      0,
      "Target must be new"
    );
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit && run.source.executedCommit === run.source.requestedCommit);
    const sourceFunds = await source.collection("indexFunds").find({}).sort({ _id: 1 }).toArray();
    const originalHash = hash(sourceFunds);
    const collections = [
      "gameState",
      "gameConfig",
      "exchangeRates",
      "indexFunds",
      "indexFundPositions",
      "corporations",
      "corporateSectors",
      "bonds",
      "bondMarketPools",
      "equityMarketPools",
      "shareListings",
      "federalBudget",
      "centralBanks",
      "countries",
      "countryGameStates",
      "indexFundListingPetitions",
      "indexFundListingWaivers",
    ];
    const copied: Record<string, number> = {};
    for (const name of collections) {
      const rows = await source.collection(name).find({}).toArray();
      if (rows.length) await target.collection(name).insertMany(rows);
      copied[name] = rows.length;
    }
    for (const [name, query, projection] of [
      [
        "npps",
        {},
        {
          _id: 1,
          countryId: 1,
          favorability: 1,
          politicalInfluence: 1,
          funds: 1,
          nppInvestmentCashAnchor: 1,
          lastIndexFundInvestmentTurn: 1,
          retiredAt: 1,
        },
      ],
      ["shareOrders", { status: "open" }, undefined],
      ["indexFundRedemptionQueue", { units: { $gt: 0 } }, undefined],
    ] as const) {
      const rows = await source.collection(name).find(query, { projection }).toArray();
      if (rows.length) await target.collection(name).insertMany(rows);
      copied[name] = rows.length;
    }
    // Preserve source query indexes so the focused continuation has production lookup costs.
    for (const name of [...Object.keys(copied), "indexFundTransactions", "financialTxLog"]) {
      const exists = (await source.listCollections({ name }, { nameOnly: true }).toArray()).length;
      if (!exists) continue;
      for (const index of await source.collection(name).indexes()) {
        if (index.name === "_id_" || index.key._fts) continue;
        await target.collection(name).createIndex(index.key, {
          name: index.name,
          ...(index.unique ? { unique: true } : {}),
          ...(index.sparse ? { sparse: true } : {}),
          ...(index.partialFilterExpression
            ? { partialFilterExpression: index.partialFilterExpression }
            : {}),
        });
      }
    }
    const config = await target.collection("gameConfig").findOne({});
    assert(
      config?.indexFundsMode === "full" &&
        config.nppFundRedemptionEnabled &&
        config.equityLiquidityFacilityEnabled
    );
    const before = await audit(target);
    const { runIndexFundCron } = await import("../../src/lib/indexFunds/fundCron");
    const start = (await target.collection("gameState").findOne({}))!.currentTurn;
    const turns = [];
    let walletVerified = 0;
    for (let turn = start; turn < start + 9; turn++) {
      await target.collection("gameState").updateOne({}, { $set: { currentTurn: turn } });
      const wallets = new Map(
        (
          await target
            .collection("npps")
            .find({}, { projection: { nppInvestmentCashAnchor: 1 } })
            .toArray()
        ).map((n) => [String(n._id), n.nppInvestmentCashAnchor ?? 0])
      );
      const cashBefore = new Map(
        (
          await target
            .collection("indexFunds")
            .find({}, { projection: { cashAnchor: 1 } })
            .toArray()
        ).map((f) => [String(f._id), f.cashAnchor])
      );
      const poolsBefore = await target.collection("bondMarketPools").find({}).toArray();
      phaseRoundTrips = 0;
      phaseReadBytes = 0;
      measuring = true;
      const result = await runIndexFundCron(target, { currentTurn: turn });
      measuring = false;
      assert.deepEqual(result.errors, []);
      if (turn % 4 !== 0) {
        const payouts = await target
          .collection("financialTxLog")
          .find({ type: "index_fund_redeem", subjectType: "npp", turn })
          .toArray();
        const sums = new Map<string, number>();
        for (const p of payouts)
          if (p.subjectId)
            sums.set(String(p.subjectId), (sums.get(String(p.subjectId)) ?? 0) + p.anchorAmount);
        for (const n of await target
          .collection("npps")
          .find(
            { _id: { $in: [...sums.keys()].map((id) => new ObjectId(id)) } },
            { projection: { nppInvestmentCashAnchor: 1 } }
          )
          .toArray()) {
          const expected = sums.get(String(n._id))!;
          assert(
            Math.abs(n.nppInvestmentCashAnchor - wallets.get(String(n._id))! - expected) <=
              1e-6 * Math.max(1, expected)
          );
          walletVerified++;
        }
      }
      const flows = await target.collection("financialTxLog").find({ turn }).toArray();
      const cashFlows = new Map<string, number>();
      for (const flow of flows) {
        if (flow.subjectType === "fund")
          cashFlows.set(
            String(flow.subjectId),
            (cashFlows.get(String(flow.subjectId)) ?? 0) + flow.anchorAmount
          );
        else if (
          ["index_fund_subscribe", "index_fund_redeem"].includes(flow.type) &&
          flow.meta?.fundId
        )
          cashFlows.set(
            flow.meta.fundId,
            (cashFlows.get(flow.meta.fundId) ?? 0) - flow.anchorAmount
          );
      }
      let maxFundCashResidual = 0;
      for (const f of await target
        .collection("indexFunds")
        .find({}, { projection: { cashAnchor: 1, slug: 1 } })
        .toArray()) {
        const residual =
          f.cashAnchor - cashBefore.get(String(f._id))! - (cashFlows.get(String(f._id)) ?? 0);
        maxFundCashResidual = Math.max(maxFundCashResidual, Math.abs(residual));
        assert(Math.abs(residual) < 0.02, `Unexplained fund cash movement ${f.slug}: ${residual}`);
      }
      let maxPoolCashResidual = 0;
      for (const beforePool of poolsBefore) {
        const afterPool = (await target
          .collection("bondMarketPools")
          .findOne({ _id: beforePool._id }))!;
        const expected =
          (afterPool.lifetime.purchasesIn ?? 0) -
          (beforePool.lifetime.purchasesIn ?? 0) -
          ((afterPool.lifetime.salesOut ?? 0) - (beforePool.lifetime.salesOut ?? 0));
        const residual = afterPool.cashLocal - beforePool.cashLocal - expected;
        maxPoolCashResidual = Math.max(maxPoolCashResidual, Math.abs(residual));
        assert(
          Math.abs(residual) < 0.02,
          `Unexplained bond dealer cash movement ${String(beforePool._id)}: ${residual}`
        );
      }
      const health = await audit(target);
      turns.push({
        turn,
        ...result,
        health,
        maxFundCashResidual,
        maxPoolCashResidual,
        phaseRoundTrips,
        phaseReadBytes,
      });
      console.error(
        JSON.stringify({
          turn,
          redemptions: result.redemptionsPaid,
          invested: result.nppInvested,
          health,
        })
      );
    }
    const { fillBestBuyOrderForMarketSell } =
      await import("../../src/lib/corporations/commands/shareTrading/fillBestBuyOrder");
    const { creditShares } = await import("../../src/lib/corporations/shareholderOps");
    const bids = await target
      .collection("shareOrders")
      .find({
        type: "buy",
        status: "open",
        liquidityProvider: true,
        placerFundId: { $exists: true },
        sharesRemaining: { $gte: 1 },
        escrowAnchor: { $gt: 0 },
      })
      .toArray();
    let saleEvidence: unknown = null;
    for (const bid of bids) {
      const corp = await target
        .collection<Corporation>("corporations")
        .findOne({ _id: bid.corporationId, publicFloat: { $gte: 1 } });
      if (!corp) continue;
      // A controlled seller receives one existing public-float share, conserving total shares.
      const sellerId = new ObjectId();
      await target.collection("characters").insertOne({
        _id: sellerId,
        name: "Sandbox acceptance seller",
        countryId: "US",
        cashOnHand: 0,
        currencyBalances: { personal: { USD: 0 } },
      });
      assert(
        await creditShares(
          target,
          corp._id,
          sellerId,
          1,
          { $inc: { publicFloat: -1 } },
          { guardFilter: { publicFloat: { $gte: 1 } } }
        )
      );
      const refreshedCorp = (await target
        .collection<Corporation>("corporations")
        .findOne({ _id: corp._id }))!;
      const cashBeforeFill = new Map(
        (
          await target
            .collection("indexFunds")
            .find({}, { projection: { cashAnchor: 1 } })
            .toArray()
        ).map((f) => [String(f._id), f.cashAnchor])
      );
      const result = await fillBestBuyOrderForMarketSell({
        db: target,
        corporation: refreshedCorp,
        seller: {
          id: sellerId,
          name: "Sandbox acceptance seller",
          collectionName: "characters",
          homeCurrency: "USD",
          isImperial: false,
        },
        shares: 1,
        forexEnabled: true,
        sellerFxRate: 1,
        now: new Date(),
        turn: start + 8,
      });
      assert(result.filled, "Existing fund bid must be reachable from market sell");
      const filledOrder = (await target
        .collection("shareOrders")
        .findOne({ _id: result.orderId }))!;
      const seller = (await target.collection("characters").findOne({ _id: sellerId }))!;
      assert(Math.abs(seller.currencyBalances.personal.USD - result.proceedsAnchor) < 1e-8);
      const afterCorp = (await target
        .collection<Corporation>("corporations")
        .findOne({ _id: corp._id }))!;
      assert.equal(afterCorp.totalShares, corp.totalShares);
      const fundAfterFill = (await target
        .collection("indexFunds")
        .findOne({ _id: filledOrder.placerFundId }))!;
      const filledOriginal = bids.find((row) => String(row._id) === String(result.orderId))!;
      assert(
        Math.abs(filledOriginal.escrowAnchor - filledOrder.escrowAnchor - result.proceedsAnchor) <
          1e-8
      );
      assert.equal(fundAfterFill.cashAnchor, cashBeforeFill.get(String(filledOrder.placerFundId)));
      saleEvidence = {
        shares: 1,
        sellerCashCredit: result.proceedsAnchor,
        escrowDebit: filledOriginal.escrowAnchor - filledOrder.escrowAnchor,
        totalSharesConserved: true,
        health: await audit(target),
      };
      break;
    }
    assert(saleEvidence, "A live fund bid and transferable share are required");
    const final = await audit(target);
    for (const step of [...turns.map((t) => t.health), final]) {
      assert.deepEqual(
        step.failures,
        [],
        "Every post-phase fund must meet strict backing and buffer floors"
      );
      assert.equal(
        step.missingPrices + step.orphanHoldings + step.orphanPositions + step.capTableMismatches,
        0
      );
    }
    assert(walletVerified > 0, "Direct wallet-delta verification must execute");
    assert.equal(
      await target.collection("indexFundRedemptionQueue").countDocuments({ units: { $gt: 0 } }),
      0
    );
    const subscriptions = await target
      .collection("indexFundTransactions")
      .find({ kind: "subscription", nppId: { $exists: true } })
      .toArray();
    const redemptions = await target
      .collection("indexFundTransactions")
      .find({ kind: "redemption", nppId: { $exists: true } })
      .toArray();
    const pairs = new Set(subscriptions.map((r) => `${r.nppId}:${r.fundId}`));
    const roundTripPairs = redemptions.filter((r) => pairs.has(`${r.nppId}:${r.fundId}`)).length;
    assert(roundTripPairs > 0);
    for (const row of redemptions)
      assert(Math.abs(row.amountAnchor - row.units * row.navAnchor) < 1e-8);
    const tx = await target
      .collection("indexFundTransactions")
      .aggregate([{ $group: { _id: "$kind", count: { $sum: 1 } } }])
      .toArray();
    assert.equal(
      hash(await source.collection("indexFunds").find({}).sort({ _id: 1 }).toArray()),
      originalHash,
      "Source fund rows unchanged"
    );
    console.log(
      JSON.stringify(
        {
          kind: "focused saved-world fund-phase continuation",
          replayCommit: commit,
          dirty,
          sourceRun: run.runId,
          sourceCommit: run.source.executedCommit,
          originalHash,
          copied,
          before,
          turns,
          final,
          transactions: tx,
          walletVerified,
          saleEvidence,
          roundTripPairs,
          passed: true,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
