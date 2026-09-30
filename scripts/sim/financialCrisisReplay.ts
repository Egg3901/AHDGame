import { sampleFinancialMacro } from "./financialMacroReplay";
import { getBankId } from "../../src/lib/centralBank/helpers";
import type { CountryId } from "../../src/lib/constants/countries";
import { processCommodityPriceTurn } from "../../src/lib/turn/commodityPriceTurn";
import { runFinancialEuroReplay } from "./financialEuroReplay";
import { originateLoan } from "../../src/lib/banking/lending";
import { settleTransition } from "../../src/lib/banking/settlementJournal";
import { oid } from "../../src/lib/banking/rules/boundary";
/** Focused financial-phase continuation. Exogenous shocks and actor setup are reported explicitly. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import type { Corporation, FederalBudget } from "../../src/lib/db/types";
import type { CrisisInteraction, GlobalResponseRole } from "../../src/lib/db/types/crisis";
import { GLOBAL_FINANCIAL_CRISIS_DEF as def } from "../../src/lib/livingConflict/defs/globalFinancialCrisis";
import { createCrisisFromTemplate } from "../../src/lib/crises/createCrisisFromTemplate";
import {
  submitCrisisDecision,
  resolveCharacterRoles,
} from "../../src/lib/crises/interactionEngine";
import { processBankingTurn } from "../../src/lib/turn/bankingTurn";
import { processBankSolvencyTurn } from "../../src/lib/turn/bankSolvencyTurn";
import { processFinancialCrisisGuarantees } from "../../src/lib/crises/financialCrisisGuarantees";
import { loadBankingPolicy } from "../../src/lib/banking/policy";
import { processTreasuryTurn } from "../../src/lib/turn/treasuryTurn";
import { loadFinancialCrisisDemand } from "../../src/lib/livingConflict/financialDemand";
import { computeHouseholdConsumption } from "../../src/lib/turn/householdConsumption";
import { loadFinancialExposure } from "../../src/lib/livingConflict/financialExposure";
import { processSovereignLegislativeTurn } from "../../src/lib/sovereignDefault/legislative/legislativeTurn";
import { evaluateSovereignAuctionForCountry } from "../../src/lib/sovereignDefault/crisisDetection";
import { issueAdminSovereignBondSeries } from "../../src/lib/bonds/sovereign";
import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const near = (actual: number, expected: number, message: string) =>
  assert(
    Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 1e-10),
    `${message}: ${actual} != ${expected}`
  );

async function stocks(db: Db, countryId = "UK") {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  assert(budget);
  const banks = await db
    .collection<Corporation>("corporations")
    .find({ countryId: countryId as Corporation["countryId"], bankCharter: { $exists: true } })
    .toArray();
  const escrow = await db.collection("bankGuarantees").find({ countryId }).toArray();
  const cbId = getBankId(countryId as CountryId);
  const central = await db
    .collection<{ _id: string; externalBroadMoney?: number }>("centralBanks")
    .findOne({ _id: cbId });
  return {
    treasury: budget.treasuryBalance,
    debt: budget.debt.principal,
    bankCash: banks.reduce((sum, bank) => sum + (bank.bankCharter?.cashReserves ?? 0), 0),
    loans: banks.reduce((sum, bank) => sum + (bank.bankCharter?.totalLoans ?? 0), 0),
    publicCapital: banks.reduce(
      (sum, bank) => sum + (bank.bankCharter?.publicRescueCapital ?? 0),
      0
    ),
    escrow: escrow.reduce((sum, row) => sum + (row.escrowBalance ?? 0), 0),
    householdCash: central?.externalBroadMoney ?? 0,
    primarySpending: budget.spending.total - budget.spending.debtInterest,
  };
}
const actors = Object.fromEntries(
  [
    ["UK", "primeMinister"],
    ["US", "president"],
    ["DE", "chancellor"],
    ["IE", "taoiseach"],
  ].map(([countryId, type], i) => [
    countryId,
    {
      _id: new ObjectId((9000 + i).toString(16).padStart(24, "0")),
      countryId,
      name: `Replay ${countryId} executive`,
      currentOffice: { type },
    },
  ])
);

async function publicChoice(
  db: Db,
  turn: number,
  countryId: string,
  optionId: string,
  role: GlobalResponseRole = "belligerent"
) {
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
  const response = def.phases[0].events[0].response!;
  const node = {
    nodeId: `financial_replay_${turn}_${optionId}`,
    type: "choice" as const,
    title: "Financial crisis policy response",
    description: "Saved-world financial policy continuation",
    options: [],
    optionsByRole: Object.fromEntries(
      Object.entries(response.decisionTrees).map(([key, tree]) => [key, tree?.options ?? []])
    ),
    requiredRoles: ["headOfState"],
    timeLimitMinutes: 1440,
  };
  const countryIds = [countryId, ["UK", "US"].find((id) => id !== countryId)!];
  const crisisId = await createCrisisFromTemplate(db, {
    template: {
      name: node.title,
      description: node.description,
      scope: "country",
      countryIds,
      regionIds: [],
      durationTurns: 24,
      effects: [],
      wireMessageOnStart: node.title,
      wireMessageOnEnd: "Response window closed",
      autoGenerated: true,
      interactionDefinition: { decisionTree: [node], autoResolveOnExpiry: true },
    },
    scope: "country",
    countryIds,
    regionIds: [],
    currentTurn: turn,
    autoSource: "condition",
    livingConflictEventId: `financial_replay:${turn}:${countryId}:${optionId}`,
    globalResponse: {
      conflictKey: def.key,
      eventKey: "financial_replay",
      roleByCountry: Object.fromEntries(countryIds.map((id) => [id, role])),
      defaultOptionIdByRole: response.defaultOptionIdByRole,
      outcomes: response.outcomes,
      defaultOutcomeId: response.defaultOutcomeId,
    },
  });
  const interaction = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ crisisId });
  assert(interaction, "Real public interaction was materialized");
  const actor = actors[countryId];
  await submitCrisisDecision(
    db,
    interaction._id,
    optionId,
    actor._id,
    countryId,
    await resolveCharacterRoles(db, actor)
  );
  const receipt = await db
    .collection("financialCrisisBankActions")
    .findOne({ interactionId: interaction._id });
  return { crisisId, interactionId: interaction._id, receipt };
}

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && out && sourceName !== targetName);
  assert([sourceName, targetName].every((name) => /^ahd_sim_[a-zA-Z0-9_-]+$/.test(name)));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assert(!dirty || arg("development") === "true", "Acceptance requires a clean source tree");
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
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const sourceState = await source.collection("gameState").findOne({ _id: "current" as never });
    const sourceTurn = sourceState?.currentTurn ?? 0;
    const names = [
      "gameState",
      "gameConfig",
      "countryGameStates",
      "states",
      "stateBudgets",
      "statePolicies",
      "stateDemographics",
      "stateBaselines",
      "stateMetrics",
      "macroMetrics",
      "politicalMetrics",
      "governmentApprovals",
      "corporations",
      "corporateSectors",
      "corporationHistory",
      "centralBanks",
      "federalBudget",
      "bonds",
      "bondMarketPools",
      "exchangeRates",
      "bankLoans",
      "interbankLoans",
      "depositInsuranceFunds",
      "savingsAccounts",
      "characters",
      "npps",
      "politicalParties",
      "electedOfficials",
      "governmentFormations",
      "commodityPrices",
      "enactedLaws",
      "indexFunds",
      "systemSettings",
      "macroCountries",
    ];
    const retained = await Promise.all(
      names.map(
        async (name) =>
          [
            name,
            await source
              .collection(name)
              .find(
                name === "corporationHistory"
                  ? { turn: { $gte: sourceTurn - 11, $lte: sourceTurn } }
                  : {}
              )
              .sort({ _id: 1 })
              .toArray(),
          ] as const
      )
    );
    const retainedHash = hash(retained);
    for (const [name, rows] of retained)
      if (rows.length) await db.collection(name).insertMany(rows);
    await db.collection("gameConfig").updateOne(
      { _id: "default" as never },
      {
        $set: {
          privateBankingEnabled: true,
          bankPropTradingEnabled: true,
          bankContagionEnabled: true,
          crisisInteractionEnabled: true,
          householdConsumptionEnabled: true,
        },
      }
    );
    await db
      .collection("gameState")
      .updateOne(
        { _id: "current" as never },
        { $set: { livingConflictsEnabled: true, crisisInteractionEnabled: true } }
      );
    for (const actor of Object.values(actors))
      await db.collection("characters").replaceOne({ _id: actor._id }, actor, { upsert: true });
    await db
      .collection("countryGameStates")
      .updateOne({ _id: "US" as never }, { $set: { enabledForPlayers: true } }, { upsert: true });
    await db
      .collection("countryGameStates")
      .updateOne({ _id: "DE" as never }, { $set: { enabledForPlayers: true } }, { upsert: true });
    await db.collection("livingConflicts").insertOne({
      defKey: def.key,
      hasOpened: true,
      openedYear: 2008,
      phaseLevel: 2,
      status: "active",
    });
    const startTurn =
      Number(
        (await db.collection("gameState").findOne({ _id: "current" as never }))?.currentTurn ?? 480
      ) + 1;
    if (arg("scenario") === "euro") {
      const results = await runFinancialEuroReplay(db, startTurn, publicChoice);
      writeFileSync(
        out,
        JSON.stringify(
          {
            sourceCommit: run.source.executedCommit,
            replayCommit: commit,
            dirty,
            retainedHash,
            scope:
              "Focused later-era retained euro subsystem qualification; not a historical opening or whole-world run",
            results,
          },
          null,
          2
        ) + "\n"
      );
      console.log(JSON.stringify({ ok: true, out, scenario: "euro" }));
      return;
    }
    const results: Document = {};
    const before = await stocks(db);
    const approvalBefore = await db
      .collection("governmentApprovals")
      .findOne({ _id: "UK" as never });
    const electedBefore = hash(
      await db.collection("electedOfficials").find({}).sort({ _id: 1 }).toArray()
    );
    console.log("financial replay: public recapitalization");
    const rescue = await publicChoice(db, startTurn, "UK", "recapitalize");
    assert(rescue.receipt, "Public choice must finish the rescue journal");
    const after = await stocks(db);
    near(
      before.treasury - after.treasury,
      after.bankCash - before.bankCash,
      "Recap cash conservation"
    );
    near(
      after.publicCapital - before.publicCapital,
      after.bankCash - before.bankCash,
      "Public capital backing"
    );
    assert.equal(after.debt, before.debt);
    await assert.rejects(publicChoiceRetry(db, rescue.interactionId, "recapitalize", "UK"));
    assert.deepEqual(await stocks(db), after);
    const approvalAfter = await db
      .collection("governmentApprovals")
      .findOne({ _id: "UK" as never });
    assert(approvalBefore && approvalAfter);
    near(
      approvalAfter.approvalRating - approvalBefore.approvalRating,
      -0.3,
      "Rescue backlash enters approval"
    );
    assert.equal(
      hash(await db.collection("electedOfficials").find({}).sort({ _id: 1 }).toArray()),
      electedBefore
    );
    results.recapitalization = {
      before,
      after,
      duplicateRejected: true,
      approvalBefore: approvalBefore.approvalRating,
      approvalAfter: approvalAfter.approvalRating,
      electedOfficesUnchanged: true,
    };
    console.log("financial replay: public guarantee and stimulus");
    const preGuarantee = await stocks(db);
    await publicChoice(db, startTurn + 1, "UK", "guarantee");
    const postGuarantee = await stocks(db);
    near(
      preGuarantee.treasury - postGuarantee.treasury,
      postGuarantee.escrow - preGuarantee.escrow,
      "Guarantee funding conservation"
    );
    const preStimulus = await stocks(db);
    await publicChoice(db, startTurn + 2, "UK", "fiscal_stimulus");
    const postStimulus = await stocks(db);
    near(
      preStimulus.treasury - postStimulus.treasury,
      postStimulus.householdCash - preStimulus.householdCash,
      "Stimulus conservation"
    );
    const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
    const banks = await db
      .collection<Corporation>("corporations")
      .find({ bankCharter: { $exists: true } })
      .toArray();
    const demand = await loadFinancialCrisisDemand(db, startTurn + 2, banks, budgets);
    const inputs = {
      states: await db
        .collection<{
          _id: string;
          stateId: string;
          countryId: string;
          population: number;
          gdp: number;
        }>("states")
        .find(
          { countryId: "UK" },
          { projection: { stateId: 1, countryId: 1, population: 1, gdp: 1 } }
        )
        .toArray(),
      metricsByState: new Map(),
    };
    const controlFood = computeHouseholdConsumption(inputs).global.get("food")!;
    const stimulusFood = computeHouseholdConsumption({
      ...inputs,
      financialDemandByCountry: demand,
    }).global.get("food")!;
    assert(
      stimulusFood > controlFood,
      "Funded stimulus must increase actual household order demand"
    );
    results.stimulus = {
      before: preStimulus,
      after: postStimulus,
      demandMultiplier: demand.get("UK"),
      controlFood,
      stimulusFood,
    };
    console.log("financial replay: banking phase continuation");
    const banking = await processBankingTurn(db, startTurn + 3);
    const solvency = await processBankSolvencyTurn(db, startTurn + 3);
    results.banking = { banking, solvency, after: await stocks(db) };
    console.log("financial replay: funded loan, borrower loss and guarantee payout");
    await publicChoice(db, startTurn + 4, "DE", "guarantee");
    const germanBank = await db
      .collection<Corporation>("corporations")
      .findOne({ countryId: "DE", "bankCharter.status": "active" });
    assert(germanBank);
    const germanCorps = await db
      .collection<Corporation>("corporations")
      .find({ countryId: "DE", bankCharter: { $exists: false } }, { projection: { _id: 1 } })
      .toArray();
    const earners = await db
      .collection("corporationHistory")
      .aggregate<{ _id: ObjectId; income: number }>([
        {
          $match: {
            corporationId: { $in: germanCorps.map((corp) => corp._id) },
            turn: { $gte: sourceTurn - 11 },
          },
        },
        { $group: { _id: "$corporationId", income: { $avg: "$income" } } },
        { $sort: { income: -1 } },
        { $limit: 1 },
      ])
      .toArray();
    assert(earners[0], "Retained operating income must support the loan");
    const depositAmount = 10_000_000;
    const deposit = await settleTransition(db, {
      key: "replay:household_deposit",
      kind: "npc_deposit_flow",
      turn: startTurn + 4,
      currency: "EUR",
      legs: [
        {
          kind: "debit",
          amount: depositAmount,
          collection: "centralBanks",
          filter: { _id: "ECB" },
          path: "externalBroadMoney",
          note: "Controlled household saving decision",
        },
        {
          kind: "credit",
          amount: depositAmount,
          collection: "corporations",
          filter: { _id: oid(germanBank._id.toHexString()) },
          path: "bankCharter.cashReserves",
          note: "Cash-backed household deposit",
        },
      ],
      projections: [
        {
          collection: "corporations",
          filter: { _id: oid(germanBank._id.toHexString()) },
          update: { $inc: { "bankCharter.npcDeposits": depositAmount } },
          note: "Deposit liability follows funded cash",
        },
      ],
      event: { kind: "account.deposited", command: "replay.household.deposit" },
    });
    assert.equal(deposit.status, "applied");
    const loan = await originateLoan(
      db,
      germanBank._id,
      { type: "corporation", id: earners[0]._id },
      6_000_000,
      120
    );
    assert(loan.ok, JSON.stringify(loan));
    const borrower = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: earners[0]._id });
    assert(borrower && borrower.liquidCapital > 0);
    const loss = await settleTransition(db, {
      key: "replay:borrower_operating_loss",
      kind: "replay_operating_loss",
      turn: startTurn + 4,
      currency: "EUR",
      legs: [
        {
          kind: "debit",
          amount: borrower.liquidCapital,
          collection: "corporations",
          filter: { _id: oid(borrower._id.toHexString()) },
          path: "liquidCapital",
          note: "Controlled loss: borrower pays its remaining working cash to households",
        },
        {
          kind: "credit",
          amount: borrower.liquidCapital,
          collection: "centralBanks",
          filter: { _id: "ECB" },
          path: "externalBroadMoney",
          note: "Household counterpart receives the operating outlay",
        },
      ],
      projections: [],
      event: { kind: "account.withdrawn", command: "replay.operating_loss" },
    });
    assert.equal(loss.status, "applied");
    const failureTurns = [];
    for (let offset = 5; offset <= 12; offset++) {
      const turn = startTurn + offset;
      await db
        .collection("gameState")
        .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
      await loadFinancialCrisisDemand(
        db,
        turn,
        await db
          .collection<Corporation>("corporations")
          .find({ bankCharter: { $exists: true } })
          .toArray(),
        budgets
      );
      const loans = await processBankingTurn(db, turn);
      const failures = await processBankSolvencyTurn(db, turn);
      const bank = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: germanBank._id });
      failureTurns.push({
        turn,
        defaults: loans.defaultsWrittenOff,
        failures,
        status: bank?.bankCharter?.status,
        confidence: bank?.bankCharter?.confidence,
      });
      if (bank?.bankCharter?.status === "failed") break;
    }
    const guarantees = await db.collection("bankGuarantees").find({ countryId: "DE" }).toArray();
    assert(
      guarantees.some((row) => (row.claimsPaid ?? 0) > 0),
      "Real credit loss must trigger funded depositor protection"
    );
    results.failedBank = {
      fundedLoan: 6_000_000,
      borrowerOperatingOutlay: borrower.liquidCapital,
      failureTurns,
      claimsPaid: guarantees.reduce((sum, row) => sum + (row.claimsPaid ?? 0), 0),
    };
    const demandAfterLoss = await loadFinancialCrisisDemand(
      db,
      startTurn + 13,
      await db
        .collection<Corporation>("corporations")
        .find({ bankCharter: { $exists: true } })
        .toArray(),
      budgets
    );
    assert((demandAfterLoss.get("DE") ?? 1) < 1);
    assert((demandAfterLoss.get("DE") ?? 1) >= 0.8);
    const market = await processCommodityPriceTurn(startTurn + 13);
    results.creditTransmission = { afterLoss: demandAfterLoss.get("DE"), market };
    results.macro = await sampleFinancialMacro(db, startTurn + 13);
    console.log("financial replay: austerity and fiscal accrual");
    const preAusterity = await stocks(db);
    await publicChoice(db, startTurn + 28, "UK", "fiscal_consolidation");
    const postAusterity = await stocks(db);
    assert(postAusterity.primarySpending <= preAusterity.primarySpending);
    await processTreasuryTurn(startTurn + 29);
    const postAccrual = await stocks(db);
    assert.equal(postAccrual.debt, preAusterity.debt);
    results.austerity = { before: preAusterity, after: postAusterity, afterAccrual: postAccrual };
    console.log("financial replay: actual failed-auction detection");
    const detection = [];
    for (let index = 0; index < 4; index++) {
      const turn = startTurn + 36 + 12 * index;
      const issuance = await issueAdminSovereignBondSeries(db, {
        countryId: "US",
        turn,
        now: new Date(0),
        useQuarterDeficit: true,
      });
      const observed = await evaluateSovereignAuctionForCountry(db, "US", turn, Date.now());
      detection.push({
        issuance: issuance
          ? { issued: issuance.issueAmount, newPrincipal: issuance.newPrincipal }
          : null,
        observed,
      });
      if (observed?.firedThisEvaluation) break;
    }
    results.defaultDetection = detection;
    const decision = await db
      .collection("sovereignCrisisDecisions")
      .findOne({ countryCode: "US", state: "open" });
    const demandRecovered = await loadFinancialCrisisDemand(
      db,
      startTurn + 74,
      await db
        .collection<Corporation>("corporations")
        .find({ bankCharter: { $exists: true } })
        .toArray(),
      budgets
    );
    assert.equal(demandRecovered.get("DE"), 1);
    results.creditTransmission.recovered = demandRecovered.get("DE");
    results.guaranteeExpiry = await processFinancialCrisisGuarantees(
      db,
      startTurn + TURNS_PER_YEAR + 26,
      await loadBankingPolicy(db)
    );
    assert(decision, "Real funding stress must open a sovereign decision");
    if (decision) {
      const beforeDefault = await stocks(db, "US");
      await publicChoice(db, startTurn + 84, "US", "sovereign_restructure");
      const first = await processSovereignLegislativeTurn(db, Date.now(), startTurn + 108);
      const second = await processSovereignLegislativeTurn(db, Date.now(), startTurn + 132);
      const afterDefault = await stocks(db, "US");
      assert(afterDefault.debt < beforeDefault.debt);
      assert.equal(afterDefault.treasury, beforeDefault.treasury);
      results.sovereignResolution = { before: beforeDefault, after: afterDefault, first, second };
    }
    results.exposure = await loadFinancialExposure(
      db,
      new Set(budgets.map((budget) => budget.countryId))
    );
    const moves = await db
      .collection("bankMoneyMoves")
      .find({ kind: { $regex: "^financial_crisis_" } })
      .toArray();
    assert(
      moves.every(
        (move) => move.status === "applied" && move.legs.every((leg: Document) => leg.applied)
      ),
      "Financial settlements must finish"
    );
    for (const move of moves)
      near(
        move.legs.reduce(
          (sum: number, leg: Document) => sum + (leg.kind === "debit" ? -leg.amount : leg.amount),
          0
        ),
        0,
        "Balanced journal"
      );
    const report = {
      sourceCommit: run.source.executedCommit,
      replayCommit: commit,
      dirty,
      retainedHash,
      scope: "Focused retained-world financial phases, not a whole-world simulation",
      setup: [
        "Enabled banking, crisis interactions and household demand in the isolated target",
        "Installed four synthetic executive actors",
        "Opened a controlled 2008 financial policy window",
        "Retained original fiscal, monetary, corporate and debt stocks",
        "Controlled 10M household deposit funded from the monetary pool with an equal bank liability",
        "Controlled borrower operating loss paid to the household monetary pool through balanced settlement after real loan origination",
      ],
      sourceCounts: Object.fromEntries(retained.map(([name, rows]) => [name, rows.length])),
      results,
      journal: {
        completed: moves.length,
        partial: moves.filter((move) => move.status !== "applied").length,
      },
    };
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true, out, journal: report.journal }));
  } finally {
    await client.close();
  }
}
async function publicChoiceRetry(db: Db, id: ObjectId, option: string, country: string) {
  const actor = actors[country];
  return submitCrisisDecision(
    db,
    id,
    option,
    actor._id,
    country,
    await resolveCharacterRoles(db, actor)
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
