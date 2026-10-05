import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { makeCorporation } from "@/lib/test-utils/factories";
import type { CorporateSector } from "@/lib/db/types";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { processCorporationTurn } from "./corporationTurn";
import { processCommodityPriceTurn } from "./commodityPriceTurn";
import { processUnownedSectorGrowth } from "./unownedSectorGrowth";
import { runMetricEngine } from "@/lib/metricEngine/phase";
import { GET as corporationPageQuery } from "@/app/api/corporations/[id]/route";
import { GET as sectorPageQuery } from "@/app/api/corporations/[id]/sectors/[sectorId]/route";

const connection = vi.hoisted(() => ({ db: undefined as Db | undefined }));
vi.mock("@/lib/mongodb", () => ({
  getDb: async () => {
    if (!connection.db) throw new Error("Native fixture is not connected");
    return connection.db;
  },
}));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
// Keep network notification transports outside this database consumer test.
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpCreditRating: vi.fn().mockReturnValue("Fixture credit rating"),
}));

const mongoUri = process.env.AHD_LEGACY_SECTOR_MONGO_TEST_URI;

function fixtureClient(uri: string): MongoClient {
  const parsed = new URL(uri);
  if (
    parsed.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !["27018", "27020"].includes(parsed.port) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search
  ) {
    throw new Error("Native consumer fixtures require an isolated local test endpoint");
  }
  return new MongoClient(uri, { monitorCommands: true });
}

describe.skipIf(!mongoUri)("legacy persisted sector native consumers", () => {
  it.each([false, true])(
    "loads both legacy types through all consumers with rework flags=%s",
    async (enabled) => {
      const client = fixtureClient(mongoUri!);
      const db = client.db(`ahd_sim_fixture_legacy_${randomUUID().replaceAll("-", "")}`);
      const reads = new Set<string>();
      client.on("commandStarted", (event) => {
        if (event.commandName === "find") reads.add(String(event.command.find));
        if (event.commandName === "aggregate") reads.add(String(event.command.aggregate));
      });
      connection.db = db;
      resetCorpFxRateCacheForTests();
      try {
        await client.connect();
        await db.collection("gameState").insertOne({
          _id: "current",
          currentTurn: 2,
          currentYear: 1991,
          startingYear: 1991,
          preset: "1991-default",
        } as never);
        await db.collection("gameConfig").insertOne({
          _id: "default",
          marketSystemMode: "plants",
          productLinesV2Enabled: enabled,
          mediaOperatingModelsEnabled: enabled,
          mediaEditorialEnabled: enabled,
          mediaRegulationEnabled: enabled,
          mediaProductSlatesEnabled: enabled,
          brandLoyaltyEnabled: enabled,
          brandLoyaltySliceEnabled: enabled,
          qualityPremiumPricingEnabled: enabled,
        } as never);
        await db.collection("states").insertOne({
          _id: "CA",
          name: "California",
          countryId: "US",
          population: 10_000_000,
          workingAgePopulation: 6_000_000,
          gdp: 2_000_000_000,
          capitalStock: 6_000_000_000,
          outputGap: 0,
        } as never);
        await db.collection("macroMetrics").insertOne({
          _id: "CA",
          countryId: "US",
          economic: {
            gdpGrowth: { value: 2 },
            unemploymentRate: { value: 5 },
            consumerConfidence: { value: 60 },
            investorConfidence: { value: 60 },
          },
        } as never);
        await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });

        const corporations = ["automobiles", "entertainment"].map((type, index) => {
          const corporation = makeCorporation({
            name: `Legacy fixture ${type}`,
            type: type as "automobiles" | "entertainment",
            sequentialId: index + 1,
            countryId: "US",
            liquidCurrencyCode: "USD",
            liquidCapital: 10_000_000,
            marketingBudget: 0,
            logisticsBudget: 0,
            rdBudget: 0,
          });
          return corporation;
        });
        await db.collection("corporations").insertMany(corporations);
        await db.collection("corporations").updateMany({}, { $unset: { ceoId: "", userId: "" } });
        const sectors: CorporateSector[] = corporations.map((corporation) => ({
          _id: new ObjectId(),
          corporationId: corporation._id,
          sectorType: corporation.type,
          stateId: "CA",
          countryId: "US",
          strategyId: "standard",
          revenue: 1_000_000,
          profitMargin: 30,
          workers: 50,
          capitalStock: 100,
          plantCount: 1,
          producedUnits: 100,
          currentGrowthRate: 2,
          targetGrowthRate: 2,
          currentGrowthCost: 0,
          createdAt: new Date("1991-01-01"),
          updatedAt: new Date("1991-01-01"),
        }));
        await db.collection<CorporateSector>("corporateSectors").insertMany(sectors);
        await db.collection("unownedSectors").insertMany(
          sectors.map((sector) => ({
            _id: new ObjectId(),
            sectorType: sector.sectorType,
            stateId: "CA",
            countryId: "US",
            revenue: 100_000,
            headroomUnits: 10,
          }))
        );

        reads.clear();
        const commodityResult = await processCommodityPriceTurn(2);
        expect(commodityResult.commoditiesUpdated).toBeGreaterThan(0);
        const corporationResult = await processCorporationTurn(2);
        expect(corporationResult.corporationsProcessed).toBe(2);
        expect(corporationResult.sectorsProcessed).toBe(2);
        expect(Number.isFinite(corporationResult.totalIncomeGenerated)).toBe(true);
        expect(await processUnownedSectorGrowth(db)).toBe(2);
        expect(await runMetricEngine(db, 2)).toBe(1);

        for (const [index, corporation] of corporations.entries()) {
          const id = corporation._id.toHexString();
          const page = await corporationPageQuery(new Request(`http://localhost/corp/${id}`), {
            params: Promise.resolve({ id }),
          });
          expect(page.status, JSON.stringify(await page.clone().json())).toBe(200);
          const sectorId = sectors[index]._id.toHexString();
          const sector = await sectorPageQuery(new Request(`http://localhost/sector/${sectorId}`), {
            params: Promise.resolve({ id, sectorId }),
          });
          expect(sector.status, JSON.stringify(await sector.clone().json())).toBe(200);
          const payload = await sector.json();
          expect(payload.sector.sectorType).toBe(corporation.type);
        }
        if (!enabled) {
          expect(reads.has("manufacturingProductProjectsV2")).toBe(false);
          expect(reads.has("mediaProductProjectsV1")).toBe(false);
          expect(reads.has("politicalMediaOrders")).toBe(false);
        }
      } finally {
        connection.db = undefined;
        await db.dropDatabase();
        await client.close();
        resetCorpFxRateCacheForTests();
      }
    },
    90_000
  );
});
