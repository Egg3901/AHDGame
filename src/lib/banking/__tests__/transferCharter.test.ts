import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { bankTransferConflict, transferBankCharterToAcquirer } from "../transferCharter";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 150,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: 123_410_000,
    npcDeposits: 71_110_000,
    playerDeposits: 5_000_000,
    totalLoans: 0,
    ...overrides,
  };
}

describe("transferBankCharterToAcquirer", () => {
  let memory: InMemoryDb;
  let targetId: ObjectId;
  let acquirerId: ObjectId;
  const now = new Date("2026-09-03T23:30:00Z");

  function db(): Db {
    return memory as unknown as Db;
  }

  function corp(id: ObjectId): Corporation {
    const doc = memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id));
    if (!doc) throw new Error(`corporation ${id.toHexString()} missing`);
    return doc as unknown as Corporation;
  }

  it("moves an active charter and re-keys every satellite record", async () => {
    memory = createInMemoryDb();
    targetId = new ObjectId();
    acquirerId = new ObjectId();
    const otherBankId = new ObjectId();
    const targetHex = targetId.toString();
    const acquirerHex = acquirerId.toString();
    const charter = makeCharter();
    const loanId = new ObjectId();
    const lentId = new ObjectId();
    const borrowedId = new ObjectId();
    const openAccountId = new ObjectId();
    const frozenAccountId = new ObjectId();
    const closedAccountId = new ObjectId();
    const otherAccountId = new ObjectId();
    const depositorId = new ObjectId();
    const centralBankSaverId = new ObjectId();
    const chartered = { ...charter };

    memory.seed("corporations", [
      { _id: targetId, name: "Vermont Finance", bankCharter: chartered },
      { _id: acquirerId, name: "Holding Co" },
    ]);
    memory.seed("bankLoans", [
      {
        _id: loanId,
        bankCorporationId: targetId,
        currency: "USD",
        borrowerType: "npcBulk",
        principal: 1_000,
        outstanding: 900,
        ratePercent: 8,
        originatedTurn: 150,
        termTurns: 12,
        status: "current",
      },
    ]);
    memory.seed("interbankLoans", [
      {
        _id: lentId,
        lenderCorporationId: targetId,
        borrowerCorporationId: otherBankId,
        currency: "USD",
        principal: 500,
        outstanding: 500,
        ratePercent: 5,
        originatedTurn: 151,
        status: "current",
      },
      {
        _id: borrowedId,
        lenderCorporationId: otherBankId,
        borrowerCorporationId: targetId,
        currency: "USD",
        principal: 700,
        outstanding: 700,
        ratePercent: 5,
        originatedTurn: 151,
        status: "current",
      },
    ]);
    memory.seed("savingsAccounts", [
      {
        _id: openAccountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 1000,
        holder: targetHex,
        status: "open",
        version: 1,
        accruedInterest: 0,
        interestEarned: 0,
        openedTurn: 150,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: frozenAccountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 200,
        holder: targetHex,
        status: "frozen",
        version: 1,
        accruedInterest: 0,
        interestEarned: 0,
        openedTurn: 150,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: closedAccountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 0,
        holder: targetHex,
        status: "closed",
        version: 3,
        accruedInterest: 0,
        interestEarned: 5,
        openedTurn: 140,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: otherAccountId,
        ownerType: "character",
        ownerId: depositorId,
        currency: "USD",
        balance: 50,
        holder: otherBankId.toString(),
        status: "open",
        version: 1,
        accruedInterest: 0,
        interestEarned: 0,
        openedTurn: 150,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    memory.seed("characters", [
      {
        _id: depositorId,
        name: "Saver",
        currencyBalances: { campaign: 0, personal: {}, savingsHolder: { USD: targetHex } },
      },
      {
        _id: centralBankSaverId,
        name: "CB Saver",
        currencyBalances: { campaign: 0, personal: {}, savingsHolder: { USD: "centralBank" } },
      },
    ]);

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transferred).toBe(true);
    expect(result.currency).toBe("USD");
    expect(result.loansRekeyed).toBe(1);
    expect(result.interbankSidesRekeyed).toBe(2);
    expect(result.savingsAccountsRekeyed).toBe(2);
    expect(result.depositorPointersRekeyed).toBe(1);

    // The charter — ring-fenced cash included — now lives on the acquirer.
    expect(corp(acquirerId).bankCharter).toMatchObject({
      type: "retail",
      status: "active",
      currency: "USD",
      cashReserves: 123_410_000,
      npcDeposits: 71_110_000,
    });
    expect("bankCharter" in corp(targetId)).toBe(false);

    const loans = memory.collection("bankLoans").docs as unknown as {
      bankCorporationId: ObjectId;
    }[];
    expect(loans.every((l) => (l.bankCorporationId as ObjectId).equals(acquirerId))).toBe(true);

    const interbank = memory.collection("interbankLoans").docs as unknown as {
      lenderCorporationId: ObjectId;
      borrowerCorporationId: ObjectId;
    }[];
    expect(
      interbank.every(
        (l) =>
          !(l.lenderCorporationId as ObjectId).equals(targetId) &&
          !(l.borrowerCorporationId as ObjectId).equals(targetId)
      )
    ).toBe(true);

    const accounts = memory.collection("savingsAccounts").docs as unknown as {
      _id: ObjectId;
      holder: string;
    }[];
    const holderOf = (id: ObjectId) => accounts.find((a) => a._id.equals(id))?.holder;
    expect(holderOf(openAccountId)).toBe(acquirerHex);
    expect(holderOf(frozenAccountId)).toBe(acquirerHex);
    expect(holderOf(closedAccountId)).toBe(targetHex);
    expect(holderOf(otherAccountId)).toBe(otherBankId.toString());

    const chars = memory.collection("characters").docs as unknown as {
      _id: ObjectId;
      currencyBalances: { savingsHolder: Record<string, string> };
    }[];
    const pointerOf = (id: ObjectId) =>
      chars.find((c) => c._id.equals(id))?.currencyBalances.savingsHolder.USD;
    expect(pointerOf(depositorId)).toBe(acquirerHex);
    expect(pointerOf(centralBankSaverId)).toBe("centralBank");
  });

  it("refuses to move a live bank into an occupied slot and changes nothing", async () => {
    memory = createInMemoryDb();
    targetId = new ObjectId();
    acquirerId = new ObjectId();
    const loanId = new ObjectId();
    memory.seed("corporations", [
      { _id: targetId, name: "Vermont Finance", bankCharter: makeCharter() },
      { _id: acquirerId, name: "Holding Co", bankCharter: makeCharter({ charteredTurn: 100 }) },
    ]);
    memory.seed("bankLoans", [
      {
        _id: loanId,
        bankCorporationId: targetId,
        currency: "USD",
        borrowerType: "npcBulk",
        principal: 1_000,
        outstanding: 900,
        ratePercent: 8,
        originatedTurn: 150,
        termTurns: 12,
        status: "current",
      },
    ]);

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already operates a bank/);
    expect(corp(targetId).bankCharter?.charteredTurn).toBe(150);
    expect(corp(acquirerId).bankCharter?.charteredTurn).toBe(100);
    const loans = memory.collection("bankLoans").docs as unknown as {
      bankCorporationId: ObjectId;
    }[];
    expect((loans[0]?.bankCorporationId as ObjectId).equals(targetId)).toBe(true);
  });

  it("is a no-op when the target operates no bank", async () => {
    memory = createInMemoryDb();
    targetId = new ObjectId();
    acquirerId = new ObjectId();
    memory.seed("corporations", [
      { _id: targetId, name: "Plain Corp" },
      { _id: acquirerId, name: "Holding Co" },
    ]);

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);

    expect(result).toMatchObject({ ok: true, transferred: false });
    expect("bankCharter" in corp(acquirerId)).toBe(false);
  });

  it("moves an inert charter into a free slot so dead-bank recovery keeps working", async () => {
    memory = createInMemoryDb();
    targetId = new ObjectId();
    acquirerId = new ObjectId();
    memory.seed("corporations", [
      {
        _id: targetId,
        name: "Failed Bank Co",
        bankCharter: makeCharter({ status: "failed", failedTurn: 160 }),
      },
      { _id: acquirerId, name: "Holding Co" },
    ]);

    const result = await transferBankCharterToAcquirer(db(), targetId, acquirerId, now);

    expect(result).toMatchObject({ ok: true, transferred: true });
    expect(corp(acquirerId).bankCharter?.status).toBe("failed");
    expect("bankCharter" in corp(targetId)).toBe(false);
  });

  it("bankTransferConflict names both banks only for two live charters", () => {
    expect(
      bankTransferConflict(
        { name: "T", bankCharter: makeCharter() },
        { name: "A", bankCharter: makeCharter() }
      )
    ).toMatch(/already operates a bank/);
    expect(
      bankTransferConflict({ name: "T" }, { name: "A", bankCharter: makeCharter() })
    ).toBeNull();
    expect(
      bankTransferConflict({ name: "T", bankCharter: makeCharter() }, { name: "A" })
    ).toBeNull();
  });
});
