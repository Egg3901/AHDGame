import { COMMODITY_TYPES, eraScaledBasePrices } from "../../src/lib/constants/commodities";
import { applyGovernmentDemand } from "../../src/lib/turn/commodity/demandLegs";
import { getCurrencyFxRate } from "../../src/lib/currency/corporationCapital";
/** Conserved-position euro feedback qualification on an independently retained world. */
import assert from "node:assert/strict";
import type { Db, Document } from "mongodb";
import type { Bond, Corporation, FederalBudget } from "../../src/lib/db/types";
import { reserveBondUnitsForHolder } from "../../src/lib/bonds/bondHolderOps";
import { settleTransition } from "../../src/lib/banking/settlementJournal";
import { oid } from "../../src/lib/banking/rules/boundary";
import { markBook } from "../../src/lib/banking/propTrading";
import { loadFinancialExposure } from "../../src/lib/livingConflict/financialExposure";
import { evaluateSovereignAuctionForCountry } from "../../src/lib/sovereignDefault/crisisDetection";
import { processSovereignLegislativeTurn } from "../../src/lib/sovereignDefault/legislative/legislativeTurn";
import { processSovereignRecoveryTurn } from "../../src/lib/sovereignDefault/recovery/recoveryTurn";

export async function runFinancialEuroReplay(
  db: Db,
  startTurn: number,
  choose: (db: Db, turn: number, country: string, option: string) => Promise<unknown>
) {
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId: "DE" });
  const bank = await db
    .collection<Corporation>("corporations")
    .findOne({ countryId: "DE", "bankCharter.status": "active" });
  const bond = await db.collection<Bond>("bonds").findOne({
    issuerType: "sovereign",
    countryId: "DE",
    currencyCode: "EUR",
    matured: false,
    defaulted: false,
    publicFloat: { $gte: 3000 },
  });
  assert(budget && bank?.bankCharter && bond);
  const units = 3000,
    cost = units * bond.faceValue * bond.marketPrice;
  assert(cost > 0 && cost < bank.bankCharter.cashReserves!);
  const pool = await db.collection("bondMarketPools").findOne({ _id: "EUR" as never });
  assert(pool);
  const beforeUnits =
    bond.publicFloat + bond.holders.reduce((sum, holder) => sum + holder.units, 0);
  assert(
    await reserveBondUnitsForHolder(
      db,
      bond._id,
      { field: "corporationId", id: bank._id },
      units,
      new Date(),
      { avgCostPerUnit: cost / units }
    )
  );
  const position = {
    asset: "bond" as const,
    ref: bond._id.toHexString(),
    units,
    costBasis: cost,
    markValue: cost,
  };
  const payment = await settleTransition(db, {
    key: "replay:euro_conserved_bond_purchase",
    kind: "replay_bond_purchase",
    turn: startTurn,
    currency: "EUR",
    legs: [
      {
        kind: "debit",
        amount: cost,
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()) },
        path: "bankCharter.cashReserves",
        note: "Bank pays for reserved issued sovereign units",
      },
      {
        kind: "credit",
        amount: cost,
        collection: "bondMarketPools",
        filter: { _id: "EUR" },
        path: "cashLocal",
        note: "Bond float pool receives purchase consideration",
      },
    ],
    projections: [
      {
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()) },
        update: {
          $push: { "bankCharter.propBook": position },
          $inc: { "bankCharter.propBookMarkValue": cost },
        },
        note: "Portfolio memo of the same conserved holding",
      },
      {
        collection: "bondMarketPools",
        filter: { _id: "EUR" },
        update: { $inc: { "lifetime.purchasesIn": cost } },
        note: "Pool cash flow counter",
      },
    ],
    event: { kind: "account.withdrawn", command: "replay.bond.purchase" },
  });
  assert.equal(payment.status, "applied");
  const afterBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
  assert(afterBond);
  assert.equal(
    afterBond.publicFloat + afterBond.holders.reduce((sum, holder) => sum + holder.units, 0),
    beforeUnits
  );
  const purchasedBank = await db.collection<Corporation>("corporations").findOne({ _id: bank._id });
  const purchasedPool = await db.collection("bondMarketPools").findOne({ _id: "EUR" as never });
  assert(purchasedBank?.bankCharter && purchasedPool);
  assert(
    Math.abs(
      bank.bankCharter.cashReserves! +
        pool.cashLocal -
        purchasedBank.bankCharter.cashReserves! -
        purchasedPool.cashLocal
    ) < 0.01
  );
  const initialMark = await markBook(db, purchasedBank.bankCharter);
  const beforeExposure = await loadFinancialExposure(db, new Set(["DE", "IE", "UK", "US"]));
  // A policy input creates recurring financing needs; all debt, cash and
  // existing failed-fill observations remain the retained records.
  const financingIncrease = Math.max(
    0,
    budget.revenue.total + budget.gdp * 0.12 - budget.spending.total
  );
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budget._id },
    {
      $inc: { "spending.total": financingIncrease, "spending.byCategory.other": financingIncrease },
      $set: { surplus: -budget.gdp * 0.12 },
    }
  );
  const detection: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    const observation = await evaluateSovereignAuctionForCountry(
      db,
      "DE",
      startTurn + 12 * i,
      Date.now()
    );
    detection.push(observation);
    if (observation?.firedThisEvaluation) break;
  }
  const decision = await db
    .collection("sovereignCrisisDecisions")
    .findOne({ countryCode: "DE", state: "open" });
  assert(decision, "Retained failed primary fills and real rollover needs must open a decision");
  const stressedExposure = await loadFinancialExposure(db, new Set(["DE", "IE", "UK", "US"]));
  assert(stressedExposure.euroExposure >= 10);
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { eurozoneEnabled: false } });
  const excludedExposure = await loadFinancialExposure(db, new Set(["DE", "IE", "UK", "US"]));
  assert.equal(excludedExposure.euroExposure, 0);
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { eurozoneEnabled: gs?.eurozoneEnabled } });
  const preDefault = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id });
  assert(preDefault);
  await choose(db, startTurn + 48, "DE", "sovereign_restructure");
  const lower = await processSovereignLegislativeTurn(db, Date.now(), startTurn + 72);
  const upper = await processSovereignLegislativeTurn(db, Date.now(), startTurn + 96);
  const postDefault = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id });
  assert(postDefault);
  assert(postDefault.debt.principal < preDefault.debt.principal);
  assert.equal(postDefault.treasuryBalance, preDefault.treasuryBalance);
  const afterMark = await markBook(db, purchasedBank.bankCharter);
  assert(afterMark.propBookMarkValue < initialMark.propBookMarkValue);
  const postPool = await db.collection("bondMarketPools").findOne({ _id: "EUR" as never });
  const postBank = await db.collection<Corporation>("corporations").findOne({ _id: bank._id });
  assert.equal(postPool?.cashLocal, purchasedPool.cashLocal);
  assert.equal(postBank?.bankCharter?.cashReserves, purchasedBank.bankCharter.cashReserves);
  // Controlled appropriation shock changes a future spending policy, never a cash stock.
  const ordinarySpending = postDefault.spending;
  const increase = Math.max(
    0,
    postDefault.revenue.total + postDefault.gdp * 0.12 - ordinarySpending.total
  );
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { _id: budget._id },
      { $inc: { "spending.total": increase, "spending.byCategory.other": increase } }
    );
  const preAusterity = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id });
  await choose(db, startTurn + 97, "DE", "fiscal_consolidation");
  const postAusterity = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id });
  assert(preAusterity && postAusterity);
  assert(postAusterity.spending.total < preAusterity.spending.total);
  assert.equal(postAusterity.spending.debtInterest, preAusterity.spending.debtInterest);
  assert.equal(postAusterity.debt.principal, postDefault.debt.principal);
  assert.equal(postAusterity.treasuryBalance, postDefault.treasuryBalance);
  const fx = await getCurrencyFxRate(db, "EUR");
  const governmentDemand = (fiscal: FederalBudget) => {
    const global = new Map(COMMODITY_TYPES.map((c) => [c, { supply: 0, demand: 0 }]));
    applyGovernmentDemand(
      {
        federalBudgets: [fiscal],
        ledgerBasePrices: eraScaledBasePrices(1),
        fxRateForCountry: () => fx,
        ledgerCurrentYear: 2027,
        ledgerCommandEconomyEnabled: false,
        statesByCountry: new Map(),
        stateToCountry: new Map(),
      },
      global,
      new Map(),
      new Map()
    );
    return Object.fromEntries([...global].map(([c, b]) => [c, b.demand]));
  };
  const demandBefore = governmentDemand(preAusterity),
    demandAfter = governmentDemand(postAusterity);
  assert(demandAfter.healthcare_services < demandBefore.healthcare_services);
  const recovery: unknown[] = [];
  for (let offset = 98; offset <= 150; offset++)
    recovery.push(await processSovereignRecoveryTurn(db, startTurn + offset));
  const recovered = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id });
  const journals = await db
    .collection("bankMoneyMoves")
    .find({ kind: { $in: ["replay_bond_purchase", "financial_crisis_fiscal"] } })
    .toArray();
  return {
    setup: [
      "A funded bank investment reserved 3,000 existing sovereign units from the pool",
      "Euro membership, debt and failed primary-fill history retained unchanged",
      "A controlled 12%-of-GDP deficit appropriation tested the public austerity response without changing any cash stock",
    ],
    purchase: { units, cost, beforeUnits, afterUnits: beforeUnits, conservedCash: true },
    exposure: {
      before: beforeExposure,
      stressed: stressedExposure,
      membershipOff: excludedExposure.euroExposure,
    },
    detection,
    legislative: { lower, upper },
    default: {
      debtBefore: preDefault.debt.principal,
      debtAfter: postDefault.debt.principal,
      treasuryBefore: preDefault.treasuryBalance,
      treasuryAfter: postDefault.treasuryBalance,
      bankAssetBefore: initialMark.propBookMarkValue,
      bankAssetAfter: afterMark.propBookMarkValue,
      cashUnchanged: true,
    },
    austerity: {
      before: preAusterity.spending,
      after: postAusterity.spending,
      demandBefore,
      demandAfter,
    },
    recovery: {
      processed: recovery.length,
      state: recovered?.sovereignCrisisState,
      debt: recovered?.debt.principal,
    },
    journals: journals.map((j: Document) => ({
      kind: j.kind,
      status: j.status,
      net: j.legs.reduce(
        (s: number, l: Document) => s + (l.kind === "debit" ? -l.amount : l.amount),
        0
      ),
    })),
  };
}
