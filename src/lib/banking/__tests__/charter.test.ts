import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { resumeSettlement } from "../settlementJournal";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import { MONEY_MOVE_COLLECTION } from "../moneyMove";
import { emitBankingAuditEvent } from "../auditEvents";
import { CHARTER_CAPITAL_FOUNDING_MULTIPLE } from "../charter";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../auditEvents", () => ({ emitBankingAuditEvent: vi.fn() }));

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
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
    ...overrides,
  } as unknown as Corporation;
}

describe("banking charter", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Materialize collections before stubbing (lazy createMockDb).
    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collection("bankingLaws");
    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue(null);

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      // Default the advanced-charter gate open so the separation-law tests
      // exercise the jurisdiction logic; the gate has its own tests below.
      playerAdvancedBankChartersEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 42,
    });
    db.collectionMocks.corporateSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sectorType: "financial",
    });
  });

  async function importCharter() {
    return import("../charter");
  }

  describe("getCharterCapitalRequirement", () => {
    it("returns the charter multiple of founding cost / eraUnitScale / gdpAnchorRate (never a flat constant)", async () => {
      const { getCharterCapitalRequirement } = await importCharter();
      const required = await getCharterCapitalRequirement(db as unknown as Db, "USD");
      const scale = getEraUnitScale("2019-default");
      const rate = getGdpAnchorRate("US", "2019-default");
      expect(required).toBe(
        Math.max(
          1,
          Math.round((CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE) / scale / rate)
        )
      );
      expect(required).not.toBe(CORPORATION_FOUNDING_COST);
    });

    it("deflates for a 1953 world via era unit scale", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
      });
      const { getCharterCapitalRequirement } = await importCharter();
      const required = await getCharterCapitalRequirement(db as unknown as Db, "USD");
      const scale = getEraUnitScale("1953-default");
      expect(scale).toBeGreaterThan(1);
      expect(required).toBe(
        Math.max(
          1,
          Math.round((CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE) / scale)
        )
      );
      expect(required).toBeLessThan(CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE);
    });
  });

  describe("getLegalCharterTypes (per-country separation law)", () => {
    async function importSeparationLaw() {
      return import("../separationLaw");
    }

    it("allows universal in a modern world with no enacted law", async () => {
      const { getLegalCharterTypes } = await importSeparationLaw();
      await expect(getLegalCharterTypes(db as unknown as Db, "US")).resolves.toEqual([
        "retail",
        "investment",
        "universal",
      ]);
    });

    it("defaults to separation in a historical era with no enacted law", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      const { getLegalCharterTypes } = await importSeparationLaw();
      await expect(getLegalCharterTypes(db as unknown as Db, "US")).resolves.toEqual([
        "retail",
        "investment",
      ]);
    });

    it("allows universal in a historical era when the country repealed separation", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
        _id: "US",
        separation: "universal",
        enactedTurn: 5,
      });
      const { getLegalCharterTypes } = await importSeparationLaw();
      const types = await getLegalCharterTypes(db as unknown as Db, "US");
      expect(types).toContain("universal");
    });

    it("enforces an enacted separation law even in a modern world", async () => {
      db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
        _id: "US",
        separation: "separated",
        enactedTurn: 5,
      });
      const { getLegalCharterTypes } = await importSeparationLaw();
      await expect(getLegalCharterTypes(db as unknown as Db, "US")).resolves.toEqual([
        "retail",
        "investment",
      ]);
    });

    it("offers only retail while the advanced-charter gate is off", async () => {
      // Flag absent/false withholds investment + universal from players even
      // where the jurisdiction would allow them.
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: true,
        playerAdvancedBankChartersEnabled: false,
      });
      db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
        _id: "US",
        separation: "universal",
        enactedTurn: 5,
      });
      const { getLegalCharterTypes } = await importSeparationLaw();
      await expect(getLegalCharterTypes(db as unknown as Db, "US")).resolves.toEqual(["retail"]);
    });

    it("offers no charters in a command economy", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: true,
        commandEconomyEnabled: true,
      });
      const { getLegalCharterTypes } = await importSeparationLaw();
      await expect(getLegalCharterTypes(db as unknown as Db, "RU")).resolves.toEqual([]);
    });
  });

  describe("checkCharterEligibility", () => {
    it("fails when private banking flag is off", async () => {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: false,
      });
      const { checkCharterEligibility } = await importCharter();
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp(),
        "retail",
        "USD"
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => /not enabled/i.test(r))).toBe(true);
    });

    it("fails when corp has no financial sector", async () => {
      db.collectionMocks.corporateSectors!.findOne.mockResolvedValue(null);
      const { checkCharterEligibility } = await importCharter();
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp(),
        "retail",
        "USD"
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => /financial sector/i.test(r))).toBe(true);
    });

    it("fails when treasury is insufficient", async () => {
      const { checkCharterEligibility, getCharterCapitalRequirement } = await importCharter();
      const requirement = await getCharterCapitalRequirement(db as unknown as Db, "USD");
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp({ liquidCapital: requirement - 1 }),
        "retail",
        "USD"
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => /Insufficient treasury/i.test(r))).toBe(true);
    });

    it("fails for a universal charter under an era-default separation law", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      const { checkCharterEligibility } = await importCharter();
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp({ liquidCapital: 1_000_000_000 }),
        "universal",
        "USD"
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => /separation|universal/i.test(r))).toBe(true);
    });

    it("fails when an active charter already exists", async () => {
      const { checkCharterEligibility } = await importCharter();
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp({
          bankCharter: {
            type: "retail",
            status: "active",
            currency: "USD",
            charteredTurn: 1,
            postedCapital: 10_000_000,
            cashReserves: 10_000_000,
            depositOffset: 0,
            lendingOffset: 0,
          },
        }),
        "retail",
        "USD"
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => /already has an active/i.test(r))).toBe(true);
    });

    it("passes when all objective criteria are met", async () => {
      const { checkCharterEligibility } = await importCharter();
      const result = await checkCharterEligibility(
        db as unknown as Db,
        makeCorp(),
        "retail",
        "USD"
      );
      expect(result).toEqual({ eligible: true, reasons: [], requirement: expect.any(Number) });
    });
  });

  describe("issueCharter", () => {
    function charterWorld(corp: Corporation) {
      const memory = createInMemoryDb();
      memory.seed("corporations", [{ ...corp }]);
      memory.seed("gameConfig", [
        { _id: "default", privateBankingEnabled: true, playerAdvancedBankChartersEnabled: true },
      ]);
      memory.seed("gameState", [{ _id: "current", preset: "2019-default", currentTurn: 42 }]);
      memory.seed("corporateSectors", [
        { _id: new ObjectId(), corporationId: corp._id, sectorType: "financial" },
      ]);
      return memory;
    }
    it("journals both capital legs and publishes one fully funded charter, including retry", async () => {
      const corp = makeCorp({ liquidCapital: 50_000_000 });
      const memory = charterWorld(corp);
      const database = memory as unknown as Db;
      const { issueCharter, getCharterCapitalRequirement } = await importCharter();
      const requirement = await getCharterCapitalRequirement(database, "USD");
      const result = await issueCharter(database, corp._id, "retail", "USD");
      expect(result).toMatchObject({ ok: true });
      const after = await database.collection("corporations").findOne({ _id: corp._id });
      expect(after).toMatchObject({
        liquidCapital: 50_000_000 - requirement,
        bankCharter: {
          cashReserves: requirement,
          postedCapital: requirement,
          status: "active",
          depositOffset: 0,
          lendingOffset: 0.25,
        },
      });
      const receipt = await database
        .collection(MONEY_MOVE_COLLECTION)
        .findOne({ kind: "bank_charter_capital" });
      expect(emitBankingAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "charter.issued", settlementId: receipt?._id }),
        database
      );
      expect(Object.keys(result).sort()).toEqual(["charter", "ok", "postedCapital"]);
      expect(receipt).toMatchObject({
        status: "applied",
        legs: [
          { kind: "debit", amount: requirement, applied: true },
          { kind: "credit", amount: requirement, applied: true },
        ],
      });
      expect((await issueCharter(database, corp._id, "retail", "USD")).ok).toBe(false);
      expect(await database.collection("corporations").findOne({ _id: corp._id })).toEqual(after);
    });
    it.each([false, true])(
      "recovers actual issuance around its atomic capital write (after=%s)",
      async (afterWrite) => {
        const corp = makeCorp({ liquidCapital: 50_000_000 });
        const memory = charterWorld(corp);
        const database = memory as unknown as Db;
        const fault = withInjectedCrash(memory, {
          collection: "corporations",
          op: "updateOne",
          onCall: 1,
          afterWrite,
        });
        const { issueCharter, getCharterCapitalRequirement } = await importCharter();
        const required = await getCharterCapitalRequirement(database, "USD");
        await expect(issueCharter(fault.db, corp._id, "retail", "USD")).rejects.toThrow();
        const receipt = await database
          .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
          .findOne({ kind: "bank_charter_capital" });
        expect(receipt).not.toBeNull();
        await resumeSettlement(database, receipt!._id);
        await resumeSettlement(database, receipt!._id);
        expect(await database.collection("corporations").findOne({ _id: corp._id })).toMatchObject({
          liquidCapital: 50_000_000 - required,
          bankCharter: { status: "active", cashReserves: required },
        });
      }
    );
    it("archives the resolved prior charter and preserves its cash boundary on reissue", async () => {
      const oldCharter: BankCharter = {
        type: "retail",
        status: "revoked",
        currency: "USD",
        charteredTurn: 10,
        postedCapital: 10_000_000,
        cashReserves: 0,
        depositOffset: 0,
        lendingOffset: 0,
        revokedTurn: 20,
        revokedReason: "prior revoke",
      };
      const corp = makeCorp({ liquidCapital: 50_000_000, bankCharter: oldCharter });
      const database = charterWorld(corp) as unknown as Db;
      const { issueCharter } = await importCharter();
      expect((await issueCharter(database, corp._id, "retail", "USD")).ok).toBe(true);
      const archived = await database
        .collection("bankCharterHistory")
        .findOne({ corporationId: corp._id });
      expect(archived).toMatchObject({
        reason: "recharter",
        archivedTurn: 42,
        charter: { status: "revoked", revokedReason: "prior revoke" },
      });
    });
  });

  describe("revokeCharter", () => {
    /**
     * State-based, because the bug these cover (ticket 1093) was invisible to a
     * call-shape assertion: the revoke wrote exactly the fields it meant to and
     * still stranded every depositor and every unit of cash on a dead charter.
     */
    function makeRevokeWorld(charter: Record<string, unknown>, depositorSavings = 0) {
      const memory = createInMemoryDb();
      const corpId = new ObjectId();
      memory.seed("corporations", [
        {
          _id: corpId,
          name: "Test Bank Corp",
          type: "financial",
          countryId: "US",
          liquidCapital: 5_000_000,
          bankCharter: charter,
        },
      ]);
      memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 100_000_000 }]);
      memory.seed("gameState", [{ _id: "current", preset: "2019-default", currentTurn: 42 }]);
      memory.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
      if (depositorSavings > 0) {
        memory.seed("characters", [
          {
            _id: new ObjectId(),
            currencyBalances: {
              savings: { USD: depositorSavings },
              savingsHolder: { USD: corpId.toString() },
            },
          },
        ]);
      }
      return { memory, corpId };
    }

    it("refunds the bank's whole cash balance when there is no deposit book", async () => {
      const cashReserves = 12_000_000;
      const { memory, corpId } = makeRevokeWorld({
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 10,
        postedCapital: 10_000_000,
        cashReserves,
        depositOffset: 0,
        lendingOffset: 0,
      });

      const { revokeCharter } = await importCharter();
      const result = await revokeCharter(memory as unknown as Db, corpId, "regulatory action");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The whole cash balance, not just what was posted: retained earnings are
      // the owner's too, and stranding them would destroy them.
      expect(result.refundedCapital).toBe(cashReserves);

      const corp = memory.collection("corporations").docs[0] as {
        liquidCapital: number;
        bankCharter: Record<string, unknown>;
      };
      expect(corp.bankCharter.status).toBe("revoked");
      expect(corp.bankCharter.revokedReason).toBe("regulatory action");
      expect(corp.liquidCapital).toBe(17_000_000);
      expect(corp.bankCharter.cashReserves).toBe(0);

      const history = memory.collection("bankCharterHistory").docs as {
        reason: string;
        charter: { status: string };
      }[];
      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe("revoked");
      expect(history[0].charter.status).toBe("revoked");
    });

    it("pays the household deposit book back before the owner sees anything", async () => {
      const { memory, corpId } = makeRevokeWorld(
        {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 10,
          postedCapital: 10_000_000,
          cashReserves: 12_000_000,
          npcDeposits: 9_000_000,
          totalDeposits: 10_000,
          depositOffset: 0,
          lendingOffset: 0,
        },
        2_000_000
      );

      const { revokeCharter } = await importCharter();
      const result = await revokeCharter(memory as unknown as Db, corpId, "run risk");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Depositors first: 9M of the 12M goes back to the money supply, and the
      // owner gets the 3M residual. The old rule refunded NOTHING while a
      // deposit book existed and returned the deposits to nobody.
      expect(result.npcDepositsReturned).toBe(9_000_000);
      expect(result.refundedCapital).toBe(3_000_000);

      const cb = memory.collection("centralBanks").docs[0] as { externalBroadMoney: number };
      expect(cb.externalBroadMoney).toBe(109_000_000);

      const corp = memory.collection("corporations").docs[0] as {
        liquidCapital: number;
        bankCharter: Record<string, unknown>;
      };
      expect(corp.liquidCapital).toBe(8_000_000);
      expect(corp.bankCharter.cashReserves).toBe(0);
      expect(corp.bankCharter.npcDeposits).toBe(0);

      // The player's pointer went home and their balance never moved.
      const saver = memory.collection("characters").docs[0] as {
        currencyBalances: { savings: { USD: number }; savingsHolder: { USD: string } };
      };
      expect(saver.currencyBalances.savingsHolder.USD).toBe("centralBank");
      expect(saver.currencyBalances.savings.USD).toBe(2_000_000);
    });
  });
});
