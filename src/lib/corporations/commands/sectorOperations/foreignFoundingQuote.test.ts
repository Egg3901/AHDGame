import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  computeBuildCost,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { SECTOR_FX_SPREAD } from "@/lib/constants/currencies";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/corporations/techTree/featureFlag", () => ({
  isSectorTechTreesEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/capexTxLog", () => ({
  emitBuildCapexTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/marketMaker", () => ({
  safeDistributeConversionSpread: vi.fn().mockResolvedValue(undefined),
}));

let GET: typeof import("@/app/api/corporations/[id]/expand-suggestions/route").GET;
let expandSector: typeof import("./expandSector").expandSector;
beforeAll(async () => {
  ({ GET } = await import("@/app/api/corporations/[id]/expand-suggestions/route"));
  ({ expandSector } = await import("./expandSector"));
}, 60_000);
beforeEach(() => vi.clearAllMocks());

describe("foreign-host founding quote equals charge", () => {
  it.each([
    ["UK", "GBP", 0.57, 4.5],
    ["JP", "JPY", 134, 3],
  ] as const)(
    "charges the quoted host price and FX spread for a US corporation entering %s",
    async (countryId, currencyCode, hostRate, primeRate) => {
      const db = createInMemoryDb();
      const corpId = new ObjectId();
      const ceoId = new ObjectId();
      const stateId = `${countryId}-HOST`;
      const liquidCapital = 1_000_000;
      // USD also floats against the anchor. Both host and wallet rates differ
      // from 1, which prevents an accidental domestic conversion from passing.
      const walletRate = 1.25;
      const corporation = {
        _id: corpId,
        name: "Test Foundry",
        countryId: "US",
        type: "manufacturing",
        liquidCurrencyCode: "USD",
        liquidCapital,
        ceoId,
      };
      db.seed("corporations", [corporation]);
      db.seed("characters", [{ _id: ceoId, stats: { businessAcumen: 64.7 } }]);
      db.seed("states", [{ _id: stateId, name: "Host", countryId, gdp: 10_000_000 }]);
      db.seed("gameState", [
        { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 49 },
      ]);
      db.seed("gameConfig", [{ _id: "default", marketSystemMode: "plants", forexEnabled: true }]);
      db.seed("centralBanks", [
        { _id: getBankId(countryId), primeRate },
        { _id: getBankId("US"), primeRate: 8 },
      ]);
      db.seed("exchangeRates", [
        { _id: "USD", currencyCode: "USD", rate: walletRate },
        { _id: currencyCode, currencyCode, rate: hostRate },
      ]);
      db.seed("macroMetrics", [
        { _id: stateId, countryId, economic: { costOfLiving: { value: 137.3 } } },
      ]);
      db.seed("unownedSectors", [
        {
          _id: new ObjectId(),
          stateId,
          countryId,
          sectorType: "manufacturing",
          industryModel: null,
          mediaDiscriminator: null,
          revenue: 1_000_000,
          headroomUnits: 100_000,
        },
      ]);
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
      const { requireBasicAuth } = await import("@/lib/api/requireAuth");
      vi.mocked(requireBasicAuth).mockResolvedValue({
        ok: true,
        user: { userId: "founder" },
      } as never);
      const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
      vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
      const context = { params: Promise.resolve({ id: corpId.toString() }) };
      const quoteResponse = await GET(
        new Request(
          `http://localhost/api/corporations/${corpId}/expand-suggestions?sectorType=manufacturing&mode=unowned`
        ),
        context
      );
      const quote = await quoteResponse.json();
      expect(quoteResponse.status).toBe(200);
      const suggestion = quote.suggestions.find(
        (row: { stateId: string }) => row.stateId === stateId
      );
      expect(suggestion).toBeDefined();
      const buildCost = computeBuildCost({
        sectorType: "manufacturing",
        strategyId: null,
        units: foundingStarterUnits("manufacturing"),
        year: 1992,
        preset: "1991-default",
        eraUnitScale: 1,
        primeRate,
        acumen: 64.7,
        hostCostOfLivingIndex: 137.3,
        founding: true,
      }).totalAnchor;
      const expectedAnchor =
        (sectorEntryFeeAnchor("1991-default") + buildCost) * (1 + SECTOR_FX_SPREAD);
      expect(suggestion.foundingTotalAnchor).toBeCloseTo(expectedAnchor, 8);
      const response = await expandSector(
        new Request(`http://localhost/api/corporations/${corpId}/sectors`, {
          method: "POST",
          body: JSON.stringify({ stateId, sectorType: "manufacturing" }),
        }),
        context
      );
      expect(response.status).toBe(201);
      const updated = await (db as unknown as Db)
        .collection<Corporation>("corporations")
        .findOne({ _id: corpId });
      const chargedAnchor = (liquidCapital - updated!.liquidCapital) / walletRate;
      expect(chargedAnchor).toBeCloseTo(suggestion.foundingTotalAnchor, 8);
      const sector = await (db as unknown as Db)
        .collection<CorporateSector>("corporateSectors")
        .findOne({ corporationId: corpId });
      expect(sector!.countryId).toBe(countryId);
      expect(sector!.buildQueue![0].costPaidAnchor).toBeCloseTo(buildCost, 8);
      expect(sector!.revenue / hostRate).toBeCloseTo(
        25 * revenuePerCapacityUnitForStrategy("manufacturing", "standard", 1),
        0
      );
    }
  );
});
