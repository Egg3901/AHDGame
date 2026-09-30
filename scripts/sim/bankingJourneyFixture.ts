/** Explicit synthetic actors against retained banking context, never a live database. */
import assert from "node:assert/strict";
import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { processBankingTurn } from "@/lib/turn/bankingTurn";
import { processBankSolvencyTurn } from "@/lib/turn/bankSolvencyTurn";
import { processFomcMeetings } from "@/lib/turn/fomcMeetingTurn";
import { BANK, BORROWER, SAVER, loadRetainedContext, setupCase } from "./bankingParameterSetup";

export { BANK, BORROWER, SAVER };
export const USER = new ObjectId("000000000000000000001328");
export const IE_USER = new ObjectId("000000000000000000001329");
export const IE_CHAIR = new ObjectId("000000000000000000001330");

export async function prepareJourney(db: Db, source: Db) {
  const retained = await loadRetainedContext(source);
  const setup = await setupCase(db, retained, {
    id: "banking_ui_journey",
    currency: "USD",
    charter: "retail",
  });
  for (const name of ["countryGameStates", "macroMetrics"])
    if (await source.collection(name).countDocuments())
      await db.collection(name).insertMany(await source.collection(name).find({}).toArray());
  await db.collection("users").insertMany([
    {
      _id: USER,
      username: "Synthetic banking player",
      email: "banking-player@example.invalid",
      role: "player",
      isAdmin: false,
      activeCharacterId: SAVER,
      createdAt: new Date(),
    },
    {
      _id: IE_USER,
      username: "Synthetic Irish chair",
      email: "irish-chair@example.invalid",
      role: "player",
      isAdmin: false,
      activeCharacterId: IE_CHAIR,
      createdAt: new Date(),
    },
  ]);
  await db.collection("characters").updateOne(
    { _id: SAVER },
    {
      $set: {
        userId: USER,
        name: "Synthetic banking player",
        isSynthetic: true,
        sequentialId: 132801,
        avatarUrl: null,
        currentOffice: null,
        countryId: "US",
      },
    }
  );
  const actor = await db.collection<Character>("characters").findOne({ _id: SAVER });
  assert(actor);
  await db.collection("characters").insertOne({
    ...actor,
    _id: IE_CHAIR,
    userId: IE_USER,
    name: "Synthetic Irish chair",
    sequentialId: 132802,
    countryId: "IE",
    currencyBalances: { personal: { IEP: 0 }, savings: {}, savingsHolder: {} },
  });
  await db.collection("corporations").updateMany(
    { _id: { $in: [BANK, BORROWER] } },
    {
      $set: {
        userId: USER,
        ceoId: SAVER,
        ceoType: "character",
        ceoVacant: false,
        countryId: "US",
        logoUrl: null,
      },
    }
  );
  await db
    .collection("corporations")
    .updateOne({ _id: BANK }, { $set: { sequentialId: 132811, name: "Journey Savings Bank" } });
  await db
    .collection("corporations")
    .updateOne(
      { _id: BORROWER },
      { $set: { sequentialId: 132812, name: "Journey Borrowing Business" } }
    );
  // These are disclosed fixture appointments, not historical elections or player consent.
  const board = Array.from({ length: 7 }, (_, i) => ({
    seatId: `seat-${i + 1}`,
    isChair: i === 0,
    occupantType: i === 0 ? "player" : "npp",
    characterId: i === 0 ? SAVER : null,
    characterName: i === 0 ? "Synthetic banking player" : `Synthetic governor ${i}`,
    nppId: i === 0 ? null : new ObjectId(`00000000000000000000134${i}`),
    alignment: "hawk",
    appointedByPresidentId: null,
    appointedAtTurn: setup.turn - 20,
    termExpiresAtTurn: setup.turn + 100,
  }));
  await db.collection("centralBanks").updateOne(
    { _id: "US" as never },
    {
      $set: {
        chairCharacterId: SAVER,
        chairMode: "player",
        chairInfamy: 0,
        fomcBoard: board,
        activeFomcMeeting: null,
        fomcMeetingHistory: [],
        lastFomcMeetingTurn: setup.turn - 8,
        fomcTermStartedAtTurn: setup.turn - 20,
        rateChangesThisTerm: 0,
        lastRateChangeTurn: setup.turn - 20,
      },
    }
  );
  await db.collection("centralBanks").updateOne(
    { _id: "IE" as never },
    {
      $set: {
        chairCharacterId: IE_CHAIR,
        chairMode: "player",
        chairInfamy: 0,
        fomcBoard: [],
        activeFomcMeeting: null,
        lastRateChangeTurn: setup.turn - 20,
      },
    }
  );
  return { setup, retainedHash: retained.hash };
}

export async function journeySnapshot(db: Db) {
  const [people, corporations, central, insurance, accounts, loans, moves, audits, state, budget] =
    await Promise.all([
      db.collection("characters").find({}).toArray(),
      db.collection("corporations").find({}).toArray(),
      db.collection("centralBanks").findOne({ _id: "US" as never }),
      db.collection("depositInsuranceFunds").findOne({ _id: "USD" as never }),
      db.collection("savingsAccounts").find({}).toArray(),
      db
        .collection("bankLoans")
        .find({ borrowerType: { $ne: "npcBulk" } })
        .toArray(),
      db.collection("bankMoneyMoves").find({}).toArray(),
      db.collection("actionAuditLog").find({}).toArray(),
      db.collection("gameState").findOne({ _id: "current" as never }),
      db.collection("federalBudget").findOne({ countryId: "US" }),
    ]);
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const cash =
    people.reduce((sum, row) => sum + number(row.currencyBalances?.personal?.USD), 0) +
    corporations.reduce(
      (sum, row) => sum + number(row.liquidCapital) + number(row.bankCharter?.cashReserves),
      0
    ) +
    number(central?.externalBroadMoney) +
    number(central?.reserveBalance) +
    number(insurance?.balance) +
    Math.max(0, number(budget?.treasuryBalance));
  return {
    turn: state?.currentTurn,
    cash,
    treasuryFiscalPosition: number(budget?.treasuryBalance),
    mint: moves
      .flatMap((row) => row.legs ?? [])
      .filter((leg) => leg.applied && leg.kind === "mint")
      .reduce((sum, leg) => sum + number(leg.amount), 0),
    burn: moves
      .flatMap((row) => row.legs ?? [])
      .filter((leg) => leg.applied && leg.kind === "burn")
      .reduce((sum, leg) => sum + number(leg.amount), 0),
    saverWallet: number(
      people.find((row) => row._id.equals(SAVER))?.currencyBalances?.personal?.USD
    ),
    savings: accounts
      .filter((row) => row.ownerId.equals(SAVER))
      .map((row) => ({
        currency: row.currency,
        balance: row.balance,
        holder: row.holder === "centralBank" ? "centralBank" : "privateBank",
        interestEarned: row.interestEarned,
        status: row.status,
      })),
    bank: corporations
      .filter((row) => row._id.equals(BANK))
      .map((row) => ({
        cash: row.bankCharter.cashReserves,
        liability: row.bankCharter.playerDeposits,
        loans: row.bankCharter.totalLoans,
        status: row.bankCharter.status,
      }))[0],
    borrowerCash: number(corporations.find((row) => row._id.equals(BORROWER))?.liquidCapital),
    loans: loans.map((row) => ({
      principal: row.principal,
      outstanding: row.outstanding,
      ratePercent: row.ratePercent,
      status: row.status,
    })),
    journals: moves.map((row) => ({
      kind: row.kind,
      status: row.status,
      turn: row.turn,
      amounts: row.legs.map((leg: { kind: string; amount: number; applied: boolean }) => ({
        kind: leg.kind,
        amount: leg.amount,
        applied: leg.applied,
      })),
    })),
    audits: audits.map((row) => ({
      action: row.action,
      category: row.category,
      turn: row.turn,
      amount: row.amount,
      currency: row.currencyCode,
      outcome: row.outcome,
      metadata: row.meta,
    })),
  };
}

export async function advanceJourney(db: Db, turn: number, year: number) {
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
  const banking = await processBankingTurn(db, turn);
  const solvency = await processBankSolvencyTurn(db, turn);
  const meetings = await processFomcMeetings(db, turn, year, new Date());
  return { banking, solvency, meetings };
}
