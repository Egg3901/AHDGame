import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

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
    it("returns 10x founding cost / eraUnitScale / gdpAnchorRate (never a flat constant)", async () => {
      const { getCharterCapitalRequirement } = await importCharter();
      const required = await getCharterCapitalRequirement(db as unknown as Db, "USD");
      const scale = getEraUnitScale("2019-default");
      const rate = getGdpAnchorRate("US", "2019-default");
      expect(required).toBe(
        Math.max(1, Math.round((CORPORATION_FOUNDING_COST * 10) / scale / rate))
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
      expect(required).toBe(Math.max(1, Math.round((CORPORATION_FOUNDING_COST * 10) / scale)));
      expect(required).toBeLessThan(CORPORATION_FOUNDING_COST * 10);
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
    it("debits exactly the capital requirement (money conservation)", async () => {
      const corp = makeCorp({ liquidCapital: 50_000_000 });
      const startingBalance = corp.liquidCapital;

      db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

      const { issueCharter, getCharterCapitalRequirement } = await importCharter();
      const requirement = await getCharterCapitalRequirement(db as unknown as Db, "USD");

      db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
        ...corp,
        liquidCapital: startingBalance - requirement,
        bankCharter: {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 42,
          postedCapital: requirement,
          depositOffset: 0,
          lendingOffset: 0,
          blacklist: {},
        } satisfies BankCharter,
      });

      const result = await issueCharter(db as unknown as Db, corp._id, "retail", "USD");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.postedCapital).toBe(requirement);

      const [, update] = db.collectionMocks.corporations!.findOneAndUpdate.mock.calls[0];
      expect(update.$inc.liquidCapital).toBe(-requirement);
      expect(update.$set.bankCharter.postedCapital).toBe(requirement);
      expect(update.$set.bankCharter.status).toBe("active");
      // Initial offsets are clamped into the era corridor (modern: deposit
      // [-4, 0.5] keeps 0, lending floor +0.25 lifts 0).
      expect(update.$set.bankCharter.depositOffset).toBe(0);
      expect(update.$set.bankCharter.lendingOffset).toBe(0.25);

      // Conservation: corp balance after debit + postedCapital === starting balance
      const balanceAfter = startingBalance + update.$inc.liquidCapital;
      expect(balanceAfter + result.postedCapital).toBe(startingBalance);
    });

    it("archives the old sub-doc on recharter of a non-active charter", async () => {
      db.collection("bankCharterHistory");
      const oldCharter: BankCharter = {
        type: "retail",
        status: "revoked",
        currency: "USD",
        charteredTurn: 10,
        postedCapital: 10_000_000,
        cashReserves: 10_000_000,
        depositOffset: 0,
        lendingOffset: 0,
        revokedTurn: 20,
        revokedReason: "prior revoke",
      };
      const corp = makeCorp({ liquidCapital: 50_000_000, bankCharter: oldCharter });
      db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

      const { issueCharter, getCharterCapitalRequirement } = await importCharter();
      const requirement = await getCharterCapitalRequirement(db as unknown as Db, "USD");

      db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
        ...corp,
        liquidCapital: corp.liquidCapital - requirement,
        bankCharter: {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 42,
          postedCapital: requirement,
          depositOffset: 0,
          lendingOffset: 0.25,
          blacklist: {},
        } satisfies BankCharter,
      });

      const result = await issueCharter(db as unknown as Db, corp._id, "retail", "USD");
      expect(result.ok).toBe(true);

      expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
      const archived = db.collectionMocks.bankCharterHistory!.insertOne.mock.calls[0][0];
      expect(archived.reason).toBe("recharter");
      expect(archived.archivedTurn).toBe(42);
      expect(archived.charter.status).toBe("revoked");
      expect(archived.charter.revokedReason).toBe("prior revoke");
      expect(archived.corporationId).toEqual(corp._id);
    });
  });

  describe("revokeCharter", () => {
    it("refunds the bank's whole cash balance when totalDeposits is zero or absent", async () => {
      db.collection("bankCharterHistory");
      const postedCapital = 10_000_000;
      // Retained earnings on top of the posted capital, to pin that the refund
      // is the bank's whole cash balance and not just what was posted.
      const cashReserves = 12_000_000;
      const corp = makeCorp({
        liquidCapital: 5_000_000,
        bankCharter: {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 10,
          postedCapital,
          cashReserves,
          depositOffset: 0,
          lendingOffset: 0,
        },
      });
      db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        modifiedCount: 1,
        matchedCount: 1,
      });

      const { revokeCharter } = await importCharter();
      const result = await revokeCharter(db as unknown as Db, corp._id, "regulatory action");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.refundedCapital).toBe(cashReserves);

      const [, update] = db.collectionMocks.corporations!.updateOne.mock.calls[0];
      expect(update.$set["bankCharter.status"]).toBe("revoked");
      expect(update.$set["bankCharter.revokedReason"]).toBe("regulatory action");
      expect(update.$inc.liquidCapital).toBe(cashReserves);
      expect(update.$set["bankCharter.cashReserves"]).toBe(0);

      expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
      const archived = db.collectionMocks.bankCharterHistory!.insertOne.mock.calls[0][0];
      expect(archived.reason).toBe("revoked");
      expect(archived.charter.status).toBe("revoked");
    });

    it("does not refund posted capital when deposits remain", async () => {
      db.collection("bankCharterHistory");
      const postedCapital = 10_000_000;
      const corp = makeCorp({
        liquidCapital: 5_000_000,
        bankCharter: {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 10,
          postedCapital,
          depositOffset: 0,
          lendingOffset: 0,
          totalDeposits: 1_000,
        },
      });
      db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        modifiedCount: 1,
        matchedCount: 1,
      });

      const { revokeCharter } = await importCharter();
      const result = await revokeCharter(db as unknown as Db, corp._id, "run risk");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.refundedCapital).toBe(0);

      const [, update] = db.collectionMocks.corporations!.updateOne.mock.calls[0];
      expect(update.$set["bankCharter.status"]).toBe("revoked");
      expect(update.$inc).toBeUndefined();
      expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
    });
  });
});
