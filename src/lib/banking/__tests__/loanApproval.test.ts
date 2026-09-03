/**
 * CEO approval of a pending loan, through the boundary and the journal.
 *
 * Acceptance funds the loan from the vault and flips it to current in one
 * transition guarded on `pending`, so a double accept is a replay and a loan
 * another decision already moved is refused rather than paid twice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter, BankCharterType, BankLoan } from "@/lib/db/types/bank";
import { acceptLoan, rejectLoan } from "@/lib/banking/loanApproval";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn().mockResolvedValue(undefined) }));

const BANK = new ObjectId();
const BORROWER = new ObjectId();
const BORROWER_OWNER = new ObjectId();
const LOAN = new ObjectId();
const TURN = 60;

function world(type: BankCharterType = "retail", overrides: Partial<BankCharter> = {}): InMemoryDb {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  memory.seed("centralBanks", [
    { _id: "US", countryId: "US", primeRate: 4, bankReserveRequirement: 0.1 },
  ]);
  memory.seed("corporations", [
    {
      _id: BANK,
      name: "Approval Bank",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: {
        type,
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        npcDeposits: type === "investment" ? 0 : 2_000_000,
        totalDeposits: type === "investment" ? 0 : 2_000_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 1,
        requireApproval: true,
        blacklist: {},
        ...overrides,
      },
    },
    {
      _id: BORROWER,
      name: "Borrower Corp",
      countryId: "US",
      liquidCapital: 100_000,
      liquidCurrencyCode: "USD",
      userId: BORROWER_OWNER,
    },
  ]);
  // The borrower corporation's owner receives the decision mail.
  memory.seed("characters", [
    { _id: new ObjectId(), userId: BORROWER_OWNER, name: "Owner", sequentialId: 9 },
  ]);
  memory.seed("bankLoans", [
    {
      _id: LOAN,
      bankCorporationId: BANK,
      currency: "USD",
      borrowerType: "corporation",
      borrowerId: BORROWER,
      principal: 300_000,
      outstanding: 300_000,
      ratePercent: 5,
      originatedTurn: TURN - 2,
      termTurns: 48,
      status: "pending",
      requestedTurn: TURN - 2,
    },
  ]);
  return memory;
}

function corp(memory: InMemoryDb, id: ObjectId) {
  return memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
    liquidCapital: number;
    bankCharter: BankCharter;
  };
}

function loan(memory: InMemoryDb): BankLoan {
  return memory.collection("bankLoans").docs[0] as unknown as BankLoan;
}

describe("acceptLoan", () => {
  let memory: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    memory = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  });

  it("funds the loan from the vault, credits the borrower, flips to current, once", async () => {
    const result = await acceptLoan(memory as unknown as Db, BANK, LOAN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loan).toMatchObject({ status: "current", decisionTurn: TURN });
    expect(loan(memory)).toMatchObject({ status: "current", decisionTurn: TURN });
    expect(corp(memory, BANK).bankCharter.cashReserves).toBe(700_000);
    expect(corp(memory, BANK).bankCharter.totalLoans).toBe(300_000);
    expect(corp(memory, BORROWER).liquidCapital).toBe(400_000);

    const again = await acceptLoan(memory as unknown as Db, BANK, LOAN);
    expect(again).toEqual({ ok: false, error: "Loan is not pending" });
    expect(corp(memory, BANK).bankCharter.cashReserves).toBe(700_000);
    expect(corp(memory, BORROWER).liquidCapital).toBe(400_000);
  });

  it("re-checks headroom at decision time", async () => {
    // Deposit taker: headroom = 2M x 0.9 - 0 = 1.8M; shrink the base so it binds.
    corp(memory, BANK).bankCharter.npcDeposits = 100_000;
    const result = await acceptLoan(memory as unknown as Db, BANK, LOAN);
    expect(result).toEqual({
      ok: false,
      error: "Insufficient lendable headroom to fund this loan now",
    });
    expect(loan(memory).status).toBe("pending");
  });

  it("re-checks the blacklist at decision time", async () => {
    corp(memory, BANK).bankCharter.blacklist = { corporationIds: [BORROWER.toString()] };
    const result = await acceptLoan(memory as unknown as Db, BANK, LOAN);
    expect(result).toEqual({ ok: false, error: "Borrower is on the bank's blacklist" });
  });

  it("accepts at an investment bank against its own cash", async () => {
    memory = world("investment");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    const result = await acceptLoan(memory as unknown as Db, BANK, LOAN);
    expect(result.ok).toBe(true);
    expect(corp(memory, BANK).bankCharter.cashReserves).toBe(700_000);
  });

  it("refuses a loan that is not pending and one it does not own", async () => {
    memory.collection("bankLoans").docs[0].status = "rejected";
    expect(await acceptLoan(memory as unknown as Db, BANK, LOAN)).toEqual({
      ok: false,
      error: "Loan is not pending",
    });
    expect(await acceptLoan(memory as unknown as Db, new ObjectId(), LOAN)).toEqual({
      ok: false,
      error: "Loan not found",
    });
  });
});

describe("rejectLoan", () => {
  let memory: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    memory = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  });

  it("declines with a trimmed reason and moves no money", async () => {
    const before = corp(memory, BANK).bankCharter.cashReserves;
    const result = await rejectLoan(memory as unknown as Db, BANK, LOAN, "  not this quarter  ");
    expect(result.ok).toBe(true);
    expect(loan(memory)).toMatchObject({
      status: "rejected",
      decisionTurn: TURN,
      rejectedReason: "not this quarter",
    });
    expect(corp(memory, BANK).bankCharter.cashReserves).toBe(before);
    expect(corp(memory, BORROWER).liquidCapital).toBe(100_000);
    const { sendSystemMail } = await import("@/lib/mail/systemMail");
    expect(sendSystemMail).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second decision on the same loan is refused", async () => {
    await rejectLoan(memory as unknown as Db, BANK, LOAN);
    expect(await rejectLoan(memory as unknown as Db, BANK, LOAN)).toEqual({
      ok: false,
      error: "Loan is not pending",
    });
    expect(await acceptLoan(memory as unknown as Db, BANK, LOAN)).toEqual({
      ok: false,
      error: "Loan is not pending",
    });
  });
});
