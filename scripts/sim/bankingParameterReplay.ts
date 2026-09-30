/** Source-pinned banking sensitivity cases with actual savings, lending, turn and journal code. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MongoClient, type Db, type Document } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { runSavingsCommand } from "@/lib/savings/accountsShell";
import { originateLoan } from "@/lib/banking/lending";
import { namedLoanHeadroom } from "@/lib/banking/rules/loans";
import { bankBalanceSheet } from "@/lib/banking/rules/balanceSheet";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { processBankingTurn } from "@/lib/turn/bankingTurn";
import { processBankSolvencyTurn } from "@/lib/turn/bankSolvencyTurn";
import { drawDiscountWindow } from "@/lib/banking/discountWindowCommands";
import { quoteDiscountWindow } from "@/lib/banking/rules/discountWindow";
import { oid } from "@/lib/banking/rules/boundary";
import {
  BANK,
  BORROWER,
  SAVER,
  hash,
  loadRetainedContext,
  setupCase,
  transfer,
  type ParameterCase,
} from "./bankingParameterSetup";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const scenarios: ParameterCase[] = [];
for (const currency of ["USD", "GBP", "IEP"] as const)
  for (const charter of ["retail", "universal", "investment"] as const)
    scenarios.push({ id: `baseline_${currency}_${charter}`, currency, charter });
const extra = (id: string, changes: Partial<ParameterCase>) =>
  scenarios.push({ id, currency: "USD", charter: "retail", ...changes });
for (const share of [0.1, 0.9]) extra(`capacity_${share}`, { branchShare: share });
for (const reserve of [0.05, 0.2, 0.5, 0.95]) extra(`reserve_${reserve}`, { reserve });
for (const side of ["low", "high"] as const) {
  extra(`deposit_${side}`, { depositRate: side });
  extra(`lending_${side}`, { lendingRate: side });
}
extra("new_charter_rates", { depositRate: "charter-default", lendingRate: "charter-default" });
extra("withdraw_20", { withdrawal: 0.2 });
extra("withdraw_60", { withdrawal: 0.6 });
extra("withdraw_60_window", { withdrawal: 0.6, windowBridge: true });
extra("named_default", { defaultShock: true });
extra("tight_capacity_expensive_deposits", {
  branchShare: 0.1,
  reserve: 0.05,
  depositRate: "high",
  lendingRate: "low",
});
extra("high_reserve_expensive_loans", { reserve: 0.95, lendingRate: "high" });

async function observe(db: Db, setup: Awaited<ReturnType<typeof setupCase>>) {
  const [corps, people, cb, budget, funds, accounts, journals, loans] = await Promise.all([
    db.collection<Corporation>("corporations").find({}).toArray(),
    db.collection("characters").find({}).toArray(),
    db.collection("centralBanks").findOne({ _id: setup.centralBankId as never }),
    db.collection("federalBudget").findOne({ countryId: setup.country }),
    db.collection("depositInsuranceFunds").findOne({ _id: setup.currency as never }),
    db.collection("savingsAccounts").find({}).toArray(),
    db.collection("bankMoneyMoves").find({}).toArray(),
    db.collection("bankLoans").find({}).toArray(),
  ]);
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const bank = corps.find((corp) => corp._id.equals(BANK));
  assert(bank?.bankCharter);
  const buckets = {
    companyCash: corps.reduce((sum, corp) => sum + n(corp.liquidCapital), 0),
    vaultCash: corps.reduce((sum, corp) => sum + n(corp.bankCharter?.cashReserves), 0),
    personalCash: people.reduce(
      (sum, person) => sum + n(person.currencyBalances?.personal?.[setup.currency]),
      0
    ),
    householdPool: n(cb?.externalBroadMoney),
    centralBankReserves: n(cb?.reserveBalance),
    insuranceCash: n(funds?.balance),
    // A negative treasury position is a fiscal obligation, not spendable cash.
    treasuryCash: Math.max(0, n(budget?.treasuryBalance)),
  };
  let mint = 0,
    burn = 0;
  for (const journal of journals)
    for (const leg of journal.legs ?? [])
      if (leg.applied) {
        if (leg.kind === "mint") mint += leg.amount;
        if (leg.kind === "burn") burn += leg.amount;
      }
  const sheet = bankBalanceSheet({
    charter: bank.bankCharter,
    reserveRatio: Number(cb?.bankReserveRequirement ?? 0.1),
    playerDepositsAreLiabilities: true,
    capacityCeiling: await getBankDepositCeiling(db, bank),
  });
  const saver = people.find((person) => String(person._id) === SAVER.toHexString());
  const account = accounts.find((row) => String(row.ownerId) === SAVER.toHexString());
  return {
    buckets,
    treasuryFiscalPosition: n(budget?.treasuryBalance),
    cash: Object.values(buckets).reduce((a, b) => a + b, 0),
    mint,
    burn,
    sheet,
    bankStatus: bank.bankCharter.status,
    warningBand: bank.bankCharter.warningBand,
    insurerPremiums: n(funds?.premiumsCollectedLifetime),
    insurerClaims: n(funds?.payoutsLifetime),
    treasuryInsuranceBackstop: n(funds?.treasuryBackstopLifetime),
    insuredCap: n(funds?.insuredCap),
    saverInterest: n(account?.interestEarned),
    income: {
      turn: bank.bankCharter.lastBankingIncomeTurn ?? null,
      net: n(bank.bankCharter.lastBankingIncome),
      depositInterest: n(bank.bankCharter.lastBankingDepositInterest),
      loanInterest: n(bank.bankCharter.lastBankingLoanInterest),
      facilityInterest: n(bank.bankCharter.lastBankingFacilityInterest),
      premium: n(bank.bankCharter.lastBankingInsurancePremium),
      writeoffs: n(bank.bankCharter.lastBankingWriteoffs),
    },
    saverWallet: n(saver?.currencyBalances?.personal?.[setup.currency]),
    saverClaim: n(account?.balance),
    saverAccountStatus: account?.status ?? null,
    saverHolder: account?.holder === BANK.toHexString() ? "bank" : "centralBank",
    namedLoans: loans
      .filter((loan) => loan.borrowerType !== "npcBulk")
      .map((loan) => ({
        principal: loan.principal,
        outstanding: loan.outstanding,
        ratePercent: loan.ratePercent,
        status: loan.status,
        arrearsTurns: loan.arrearsTurns ?? 0,
      })),
    journalCount: journals.length,
    partialJournals: journals.filter(
      (journal) => journal.status === "partial" || journal.status === "claimed"
    ).length,
    borrowerCash: n(corps.find((corp) => corp._id.equals(BORROWER))?.liquidCapital),
  };
}
async function runCase(
  db: Db,
  context: Awaited<ReturnType<typeof loadRetainedContext>>,
  scenario: ParameterCase
) {
  const setup = await setupCase(db, context, scenario);
  const baseline = await observe(db, setup);
  const timeline: { stage: string; state: Awaited<ReturnType<typeof observe>> }[] = [];
  let maxConservationError = 0;
  async function record(stage: string) {
    const state = await observe(db, setup);
    const expected = baseline.cash + state.mint - baseline.mint - state.burn + baseline.burn;
    const error = Math.abs(state.cash - expected);
    maxConservationError = Math.max(maxConservationError, error);
    const tolerance = Math.max(
      0.02,
      Number.EPSILON * (Math.abs(state.cash) + Math.abs(expected)) * 16
    );
    assert(
      error <= tolerance,
      `${scenario.id}/${stage}: unexplained cash delta ${state.cash - expected}`
    );
    assert.equal(state.partialJournals, 0, `${scenario.id}/${stage}: partial journal`);
    timeline.push({ stage, state });
    return state;
  }
  const holder = await runSavingsCommand(
    db,
    SAVER,
    setup.currency,
    { type: "transfer_holder", to: BANK.toHexString() },
    `${scenario.id}:holder`
  );
  const decisions: Record<string, unknown> = { holder: holder.ok ? { ok: true } : holder };
  await record("holder decision");
  if (holder.ok) {
    const asked = setup.native(100_000_000);
    const deposit = await runSavingsCommand(
      db,
      SAVER,
      setup.currency,
      { type: "deposit", amount: asked },
      `${scenario.id}:deposit`
    );
    decisions.deposit = deposit.ok ? { ok: true, amount: asked } : deposit;
    if (!deposit.ok) {
      const bank = await db.collection<Corporation>("corporations").findOne({ _id: BANK });
      assert(bank);
      const supported =
        Math.floor(Math.min(asked, await getBankDepositCeiling(db, bank)) * 100) / 100;
      const smaller = await runSavingsCommand(
        db,
        SAVER,
        setup.currency,
        { type: "deposit", amount: supported },
        `${scenario.id}:smaller-deposit`
      );
      assert(smaller.ok, `Capacity-sized deposit refused: ${JSON.stringify(smaller)}`);
      decisions.smallerDeposit = { amount: supported, ok: true };
    }
    await record("funded deposit");
  } else assert.equal(scenario.charter, "investment");
  const loaded = await loadBankingSnapshot(db, BANK, { turn: setup.turn });
  assert(loaded?.snapshot.charter);
  const headroom = namedLoanHeadroom(loaded.snapshot.charter, loaded.snapshot.reserveRatio, {
    playerDepositsAreLiabilities: true,
  });
  const principal = Math.floor(Math.min(setup.native(85_000_000), headroom) * 100) / 100;
  assert(principal > 0);
  const loan = await originateLoan(db, BANK, { type: "corporation", id: BORROWER }, principal, 12);
  assert(loan.ok, `Origination refused: ${JSON.stringify(loan)}`);
  decisions.loan = { principal, rate: loan.loan.ratePercent, termTurns: 12, headroom };
  await record("loan disbursement");
  if (scenario.defaultShock) {
    const state = await observe(db, setup);
    await transfer(
      db,
      `${scenario.id}:operating-loss`,
      setup.currency,
      state.borrowerCash,
      {
        collection: "corporations",
        filter: { _id: oid(BORROWER.toHexString()) },
        path: "liquidCapital",
      },
      setup.pool,
      setup.turn
    );
    await record("borrower pays operating loss to households");
  }
  if (scenario.withdrawal) {
    if (scenario.windowBridge) {
      const fresh = await loadBankingSnapshot(db, BANK, { turn: setup.turn });
      assert(fresh?.snapshot.charter);
      const quote = quoteDiscountWindow(fresh.snapshot.charter, fresh.snapshot.primeRate, {
        playerDepositsAreLiabilities: true,
      });
      const window = await drawDiscountWindow(db, BANK, quote.headroomAnchor, setup.turn);
      assert(window.ok, JSON.stringify(window));
      decisions.discountWindow = window;
      await record("explicit central bank window draw");
    }
    const before = await observe(db, setup),
      amount = Math.floor(before.saverClaim * scenario.withdrawal * 100) / 100;
    const withdrawal = await runSavingsCommand(
      db,
      SAVER,
      setup.currency,
      { type: "withdraw", amount },
      `${scenario.id}:withdraw`
    );
    if (scenario.withdrawal === 0.2) assert(withdrawal.ok, JSON.stringify(withdrawal));
    decisions.withdrawal = {
      amount,
      fraction: scenario.withdrawal,
      result: withdrawal.ok ? { ok: true } : withdrawal,
    };
    await record("withdrawal request");
  }
  const summaries: Document[] = [];
  for (let step = 1; step <= 12; step++) {
    const turn = setup.turn + step;
    await db
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
    if (!scenario.defaultShock)
      await transfer(
        db,
        `${scenario.id}:operating-revenue:${turn}`,
        setup.currency,
        setup.native(30_000_000),
        setup.pool,
        {
          collection: "corporations",
          filter: { _id: oid(BORROWER.toHexString()) },
          path: "liquidCapital",
        },
        turn
      );
    const banking = await processBankingTurn(db, turn);
    const solvency = await processBankSolvencyTurn(db, turn);
    summaries.push({ turn, banking, solvency });
    const state = await record(`turn ${step}`);
    const retry = await processBankingTurn(db, turn);
    const afterRetry = await observe(db, setup);
    assert.equal(
      hash(afterRetry),
      hash(state),
      `${scenario.id}: banking retry changed business stocks`
    );
    assert.equal(retry.banksProcessed, 0);
  }
  const ending = timeline.at(-1)!.state;
  if (scenario.defaultShock) {
    assert.equal(ending.namedLoans[0]?.status, "defaulted");
    assert.equal(ending.bankStatus, "failed");
  }
  const operating = timeline.filter(
    (entry) =>
      entry.stage.startsWith("turn ") &&
      entry.state.income.turn === setup.turn + Number(entry.stage.slice(5))
  );
  const summary = {
    endingStatus: ending.bankStatus,
    namedLoanStatus: ending.namedLoans[0]?.status,
    netBankingIncome: operating.reduce((sum, entry) => sum + entry.state.income.net, 0),
    depositInterestPaid: summaries.reduce(
      (sum, entry) => sum + entry.banking.depositInterestPaid,
      0
    ),
    loanInterestCollected: summaries.reduce(
      (sum, entry) => sum + entry.banking.loanInterestCollected,
      0
    ),
    defaultsWrittenOff: summaries.reduce((sum, entry) => sum + entry.banking.defaultsWrittenOff, 0),
    insurancePremium: ending.insurerPremiums - baseline.insurerPremiums,
    insuranceClaims: ending.insurerClaims - baseline.insurerClaims,
    treasuryInsuranceBackstop:
      ending.treasuryInsuranceBackstop - baseline.treasuryInsuranceBackstop,
    facilityInterest: operating.reduce(
      (sum, entry) => sum + entry.state.income.facilityInterest,
      0
    ),
    saverEndingAssets: ending.saverWallet + ending.saverClaim,
    saverInterest: ending.saverInterest,
    minimumReserveSurplus: Math.min(...timeline.map((entry) => entry.state.sheet.reserveSurplus)),
    minimumBookEquity: Math.min(...timeline.map((entry) => entry.state.sheet.bookEquity)),
    explicitMint: ending.mint - baseline.mint,
    explicitBurn: ending.burn - baseline.burn,
    journalCount: ending.journalCount,
    maxConservationError,
  };
  console.log(JSON.stringify({ id: scenario.id, ...summary }));
  return {
    scenario,
    summary,
    context: {
      fx: setup.fx,
      reserve: setup.reserve,
      retainedReserve: setup.retainedReserve,
      rates: setup.rates,
      startTurn: setup.turn,
      corridors: setup.corridors,
      retainedBank: setup.retainedBank,
      depositOffset: setup.depositOffset,
      lendingOffset: setup.lendingOffset,
    },
    decisions,
    baseline,
    timeline,
    summaries,
    maxConservationError,
  };
}
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && out && sourceName !== targetName);
  assert([sourceName, targetName].every((name) => /^ahd_sim_[a-zA-Z0-9_-]+$/.test(name)));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert(
    arg("development") === "true" ||
      !execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
    "Acceptance requires clean source"
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: targetName,
    MONGO_DB_NAME: targetName,
  });
  const client = await MongoClient.connect(uri);
  global._mongoClientPromise = Promise.resolve(client);
  try {
    const source = client.db(sourceName),
      db = client.db(targetName);
    assert.equal(
      (await db.listCollections({}, { nameOnly: true }).toArray()).length,
      0,
      "Target must be new"
    );
    const retained = await loadRetainedContext(source);
    const cases = arg("case")
      ? scenarios.filter((scenario) => arg("case")!.split(",").includes(scenario.id))
      : scenarios;
    assert(cases.length > 0);
    const results = [];
    for (const scenario of cases) {
      console.log(`case ${scenario.id}`);
      results.push(await runCase(db, retained, scenario));
      writeFileSync(
        out,
        `${JSON.stringify({ sourceCommit, partial: true, cases: results }, null, 2)}\n`
      );
    }
    assert.equal((await loadRetainedContext(source)).hash, retained.hash, "Source unchanged");
    const report = {
      sourceCommit,
      retainedSource: sourceName,
      retainedHash: retained.hash,
      sourceUnchanged: true,
      cases: results,
    };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        cases: results.length,
        maxConservationError: Math.max(...results.map((result) => result.maxConservationError)),
      })
    );
  } finally {
    await client.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
