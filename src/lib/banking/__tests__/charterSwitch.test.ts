import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const CURRENT_TURN = 42;

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 10,
    postedCapital: 1_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    blacklist: {},
    totalDeposits: 5_000_000,
    npcDeposits: 4_000_000,
    ...overrides,
  } as BankCharter;
}

function makeCorp(charter: BankCharter): Corporation {
  return {
    _id: new ObjectId(),
    name: "Test Bank Corp",
    type: "financial",
    liquidCapital: 50_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "CA",
    bankCharter: charter,
  } as unknown as Corporation;
}

describe("switchCharterType", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("corporations");
    db.collection("characters");
    db.collection("centralBanks");
    db.collection("bankingLaws");
    db.collection("bankCharterHistory");

    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      // Switching to an investment/universal charter is a player advanced-charter
      // action; enable the gate so these switch tests can reach it.
      playerAdvancedBankChartersEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: CURRENT_TURN,
    });
    db.collectionMocks.characters!.updateMany.mockResolvedValue({ modifiedCount: 3 });
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue(null);
  });

  async function importCharter() {
    return import("../charter");
  }

  function expectSwitchWrite() {
    const call = db.collectionMocks.corporations!.findOneAndUpdate.mock.calls[0];
    return call[1].$set as Record<string, unknown>;
  }

  it("returns the deposit book to the central bank when moving to investment", async () => {
    // State, not call shapes: the bug this covers was that the money supply and
    // the bank's vault BOTH ended up holding the deposit book, which no
    // assertion on an individual write can see.
    const memory = createInMemoryDb();
    const corpId = new ObjectId();
    memory.seed("corporations", [
      {
        _id: corpId,
        name: "Test Bank Corp",
        type: "financial",
        countryId: "US",
        liquidCapital: 50_000_000,
        bankCharter: { ...makeCharter(), cashReserves: 6_000_000 },
      },
    ]);
    memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 100_000_000 }]);
    memory.seed("gameState", [
      { _id: "current", preset: "2019-default", currentTurn: CURRENT_TURN },
    ]);
    memory.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, playerAdvancedBankChartersEnabled: true },
    ]);
    memory.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
    memory.seed("characters", [
      {
        _id: new ObjectId(),
        currencyBalances: {
          savings: { USD: 1_000_000 },
          savingsHolder: { USD: corpId.toString() },
        },
      },
    ]);

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(memory as unknown as Db, corpId, "investment");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.npcDepositsReturned).toBe(4_000_000);
    expect(result.depositorsFlipped).toBe(1);

    const corp = memory.collection("corporations").docs[0] as {
      bankCharter: Record<string, number | string>;
    };
    const cb = memory.collection("centralBanks").docs[0] as { externalBroadMoney: number };

    // Conservation: the household book left the vault AND arrived in the money
    // supply. It used to arrive without leaving.
    expect(cb.externalBroadMoney).toBe(104_000_000);
    expect(corp.bankCharter.cashReserves).toBe(2_000_000);
    expect(corp.bankCharter.type).toBe("investment");
    expect(corp.bankCharter.npcDeposits).toBe(0);
    expect(corp.bankCharter.totalDeposits).toBe(0);
    // The floor has to follow the deposits out, or the CEO stays locked out of
    // their own treasury until the next banking turn recomputes it.
    expect(corp.bankCharter.reserveFloor).toBe(0);
  });

  it("flips depositor pointers without touching a single savings balance", async () => {
    const corp = makeCorp(makeCharter());
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      ...corp,
      bankCharter: { ...corp.bankCharter!, type: "investment" },
    });

    const { switchCharterType } = await importCharter();
    await switchCharterType(db as unknown as Db, corp._id, "investment");

    const [, update] = db.collectionMocks.characters!.updateMany.mock.calls[0];
    const set = update.$set as Record<string, unknown>;
    expect(set["currencyBalances.savingsHolder.USD"]).toBe("centralBank");
    for (const key of Object.keys(set)) {
      expect(key).not.toMatch(/currencyBalances\.savings\.[A-Z]{3}$/);
    }
  });

  it("keeps the deposit book when the target still takes deposits", async () => {
    const corp = makeCorp(makeCharter({ type: "retail" }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      ...corp,
      bankCharter: { ...corp.bankCharter!, type: "universal" },
    });

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(db as unknown as Db, corp._id, "universal");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.npcDepositsReturned).toBe(0);
    expect(db.collectionMocks.characters!.updateMany).not.toHaveBeenCalled();
    expect(expectSwitchWrite()["bankCharter.totalDeposits"]).toBeUndefined();
  });

  it("stamps a cooldown and refuses a second switch inside it", async () => {
    const corp = makeCorp(makeCharter());
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      ...corp,
      bankCharter: { ...corp.bankCharter!, type: "investment" },
    });

    const { switchCharterType, CHARTER_SWITCH_COOLDOWN_TURNS } = await importCharter();
    const first = await switchCharterType(db as unknown as Db, corp._id, "investment");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.cooldownUntilTurn).toBe(CURRENT_TURN + CHARTER_SWITCH_COOLDOWN_TURNS);

    const locked = makeCorp(
      makeCharter({
        type: "investment",
        charterSwitchCooldownUntilTurn: CURRENT_TURN + CHARTER_SWITCH_COOLDOWN_TURNS,
      })
    );
    db.collectionMocks.corporations!.findOne.mockResolvedValue(locked);

    const second = await switchCharterType(db as unknown as Db, locked._id, "retail");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.blockers).toContain("cooldown");
  });

  it("allows the switch again once the cooldown has run out", async () => {
    const corp = makeCorp(
      makeCharter({ type: "investment", charterSwitchCooldownUntilTurn: CURRENT_TURN })
    );
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      ...corp,
      bankCharter: { ...corp.bankCharter!, type: "retail" },
    });

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(db as unknown as Db, corp._id, "retail");
    expect(result.ok).toBe(true);
  });

  it("refuses to strand a discount-window balance on a charter that cannot hold one", async () => {
    const corp = makeCorp(makeCharter({ discountWindowDebt: 250_000 }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(db as unknown as Db, corp._id, "investment");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toContain("discount_window_outstanding");
    expect(db.collectionMocks.corporations!.findOneAndUpdate).not.toHaveBeenCalled();
    // Nothing partial: the deposit book must survive a refused switch.
    expect(db.collectionMocks.characters!.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to strand CB margin debt on a retail charter", async () => {
    const corp = makeCorp(makeCharter({ type: "universal", cbMarginDebt: 100_000 }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(db as unknown as Db, corp._id, "retail");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toContain("cb_margin_outstanding");
  });

  it("rejects a switch to the type the bank already holds", async () => {
    const corp = makeCorp(makeCharter({ type: "retail" }));
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { switchCharterType } = await importCharter();
    const result = await switchCharterType(db as unknown as Db, corp._id, "retail");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toContain("same_type");
  });

  it("archives the outgoing charter so the history survives the type change", async () => {
    const corp = makeCorp(makeCharter());
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      ...corp,
      bankCharter: { ...corp.bankCharter!, type: "investment" },
    });

    const { switchCharterType } = await importCharter();
    await switchCharterType(db as unknown as Db, corp._id, "investment");

    expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
    const [doc] = db.collectionMocks.bankCharterHistory!.insertOne.mock.calls[0];
    expect((doc as { charter: BankCharter }).charter.type).toBe("retail");
  });
});
