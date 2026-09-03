/**
 * Every charter type's loan book advances each turn.
 *
 * The defect this pins: an investment bank could originate a corporation loan
 * (`lending.ts` allows it) and the banking turn then never serviced it, because
 * the turn only iterated retail and universal charters. The loan sat at full
 * principal forever, the borrower was never charged, and the bank earned
 * nothing. Retail and universal are the controls: the same loan on each of the
 * three charter types must land in the same state after one turn.
 *
 * Runs against the in-memory store rather than call-recording mocks, because
 * the property under test is "did the loan actually move", which a mock that
 * accepts any write cannot answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter, BankCharterType, BankLoan } from "@/lib/db/types/bank";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { originateLoan } from "@/lib/banking/lending";
import { processBankingTurn } from "../bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
  recordAuditBulk: vi.fn(),
}));

const TURN = 100;
const PRINCIPAL = 12_000;
const TERM = 48;

function charter(type: BankCharterType, overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type,
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 2_000_000,
    cashReserves: 2_000_000,
    // Deposit takers fund named loans from lendable deposits; an investment
    // bank funds them from its own cash. Give the deposit takers a base so the
    // same principal is inside every charter's cap.
    npcDeposits: type === "investment" ? 0 : 1_000_000,
    totalDeposits: type === "investment" ? 0 : 1_000_000,
    totalLoans: 0,
    depositOffset: 0,
    lendingOffset: 0,
    blacklist: {},
    ...overrides,
  };
}

interface World {
  db: InMemoryDb;
  bankId: ObjectId;
  borrowerId: ObjectId;
}

function makeWorld(type: BankCharterType): World {
  const db = createInMemoryDb();
  const bankId = new ObjectId();
  const borrowerId = new ObjectId();
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      // No household pool: keeps NPC deposit flow and the household book at
      // zero so the only thing that moves in the turn is the named loan.
      externalBroadMoney: 0,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("corporations", [
    {
      _id: bankId,
      name: `${type} bank`,
      type: "financial",
      countryId: "US",
      liquidCapital: 100_000,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: charter(type),
    },
    {
      _id: borrowerId,
      name: "Borrower Inc",
      type: "manufacturing",
      countryId: "US",
      liquidCapital: 500_000,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
    },
  ]);
  // Twelve turns of income so the borrower's DTI cap clears the principal.
  db.seed(
    "corporationHistory",
    Array.from({ length: 12 }, (_, i) => ({
      _id: new ObjectId(),
      corporationId: borrowerId,
      turn: TURN - 11 + i,
      income: 200_000,
    }))
  );
  return { db, bankId, borrowerId };
}

async function bank(world: World) {
  const doc = (await world.db.collection("corporations").findOne({ _id: world.bankId })) as {
    bankCharter: BankCharter;
  } | null;
  return doc!.bankCharter;
}

async function borrowerCash(world: World): Promise<number> {
  const doc = (await world.db.collection("corporations").findOne({ _id: world.borrowerId })) as {
    liquidCapital: number;
  } | null;
  return doc!.liquidCapital;
}

async function loans(world: World): Promise<BankLoan[]> {
  return (await world.db
    .collection("bankLoans")
    .find({ bankCorporationId: world.bankId })
    .toArray()) as unknown as BankLoan[];
}

async function originateAndRunOneTurn(type: BankCharterType) {
  const world = makeWorld(type);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(world.db as unknown as Db);

  const originated = await originateLoan(
    world.db as unknown as Db,
    world.bankId,
    { type: "corporation", id: world.borrowerId },
    PRINCIPAL,
    TERM
  );
  expect(originated.ok, `origination on a ${type} charter`).toBe(true);
  if (!originated.ok) throw new Error(originated.error);

  const cashBefore = (await bank(world)).cashReserves ?? 0;
  const borrowerBefore = await borrowerCash(world);
  const summary = await processBankingTurn(world.db as unknown as Db, TURN + 1);
  const after = await bank(world);
  const [loan] = await loans(world);
  return {
    world,
    summary,
    loan,
    ratePercent: originated.loan.ratePercent,
    cashDelta: (after.cashReserves ?? 0) - cashBefore,
    borrowerDelta: borrowerBefore - (await borrowerCash(world)),
    totalLoansAfter: after.totalLoans ?? 0,
    stamped: after.lastBankingTurn,
  };
}

describe("named loan servicing across charter types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("advances an investment bank's corporation loan by one instalment", async () => {
    const run = await originateAndRunOneTurn("investment");
    // remainingTurns counts from origination at TURN; one turn has passed.
    const remaining = Math.max(1, TURN + TERM - (TURN + 1));
    const interestDue = (PRINCIPAL * (run.ratePercent / 100)) / TURNS_PER_YEAR;
    const principalDue = PRINCIPAL / remaining;

    expect(run.summary.banksProcessed).toBe(1);
    expect(run.loan.status).toBe("current");
    expect(run.loan.lastProcessedTurn).toBe(TURN + 1);
    expect(run.loan.outstanding).toBeCloseTo(PRINCIPAL - principalDue, 6);
    expect(run.summary.loanInterestCollected).toBeCloseTo(interestDue, 6);
    expect(run.summary.loanPrincipalRepaid).toBeCloseTo(principalDue, 6);
    expect(run.cashDelta).toBeCloseTo(interestDue + principalDue, 6);
    expect(run.borrowerDelta).toBeCloseTo(interestDue + principalDue, 6);
    expect(run.totalLoansAfter).toBeCloseTo(PRINCIPAL - principalDue, 6);
    expect(run.stamped).toBe(TURN + 1);
  });

  it("services the same loan identically on retail, universal and investment charters", async () => {
    const investment = await originateAndRunOneTurn("investment");
    const retail = await originateAndRunOneTurn("retail");
    const universal = await originateAndRunOneTurn("universal");

    for (const control of [retail, universal]) {
      expect(control.loan.lastProcessedTurn).toBe(TURN + 1);
      expect(control.loan.outstanding).toBeCloseTo(investment.loan.outstanding, 6);
      expect(control.borrowerDelta).toBeCloseTo(investment.borrowerDelta, 6);
      expect(control.summary.loanPrincipalRepaid).toBeCloseTo(
        investment.summary.loanPrincipalRepaid,
        6
      );
    }
  });

  it("does not run deposit stages for the investment bank", async () => {
    const run = await originateAndRunOneTurn("investment");
    const after = await bank(run.world);
    expect(after.npcDeposits ?? 0).toBe(0);
    expect(run.summary.depositInterestPaid).toBe(0);
    expect(run.summary.npcDepositDelta).toBe(0);
    // No household book was originated for a charter that takes no deposits.
    const book = await run.world.db
      .collection("bankLoans")
      .find({ bankCorporationId: run.world.bankId, borrowerType: "npcBulk" })
      .toArray();
    expect(book).toHaveLength(0);
  });

  it("is idempotent for the investment bank within a turn", async () => {
    const run = await originateAndRunOneTurn("investment");
    const outstandingAfterFirst = run.loan.outstanding;
    const again = await processBankingTurn(run.world.db as unknown as Db, TURN + 1);
    expect(again.banksProcessed).toBe(0);
    const [loan] = await loans(run.world);
    expect(loan.outstanding).toBeCloseTo(outstandingAfterFirst, 9);
  });
});
