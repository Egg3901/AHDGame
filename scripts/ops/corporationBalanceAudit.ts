/**
 * Versioned, read-only corporation balance metric extractor.
 *
 * Usage: npx tsx scripts/ops/corporationBalanceAudit.ts [--pretty]
 * Output is JSON so reports and headless simulations consume the same contract.
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import type { CorporateSector, Corporation } from "../../src/lib/db/types/corporation";
import type { NppMarketEntryFunnel } from "../../src/lib/db/types/marketFormation";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "../../src/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "../../src/lib/currency/corpEconomyFields";
import {
  buildCorporationBalanceAudit,
  type CorporationAuditInput,
} from "../../src/lib/corporations/balanceAudit/rules";
import type { CapacityDecisionAggregate } from "../../src/lib/corporations/capacityDecisionTelemetry/rules";
import { CAPACITY_DECISION_COLLECTION } from "../../src/lib/corporations/capacityDecisionTelemetry/persistence";
import { resolveMongoDbName } from "../../src/lib/mongodb";

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URL;
  if (!uri) throw new Error("MONGODB_URI or MONGO_URL is required");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(
      resolveMongoDbName({
        MONGODB_URI: process.env.MONGODB_URI,
        MONGO_URL: process.env.MONGO_URL,
        MONGODB_DB: process.env.MONGODB_DB,
        MONGO_DB_NAME: process.env.MONGO_DB_NAME,
      })
    );
    const [fxByCurrency, corporations, gameState, entryFunnel, capacityDecisions] =
      await Promise.all([
        loadFxRatesByCurrency(db),
        db
          .collection<Corporation>("corporations")
          .find(
            {},
            {
              projection: {
                _id: 1,
                ceoType: 1,
                ceoVacant: 1,
                countryOwnerId: 1,
                ownershipState: 1,
                userId: 1,
                countryId: 1,
                liquidCurrencyCode: 1,
                sharePrice: 1,
                totalShares: 1,
              },
            }
          )
          .toArray(),
        db
          .collection<{ _id: string; currentTurn?: number }>("gameState")
          .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
        db
          .collection<NppMarketEntryFunnel>("nppMarketEntryFunnels")
          .findOne({ _id: "current" }, { projection: { diagnostics: 0 } }),
        db
          .collection<{
            schemaVersion: number;
            turn: number;
            buckets: Record<string, CapacityDecisionAggregate>;
          }>(CAPACITY_DECISION_COLLECTION)
          .findOne(
            {},
            { projection: { buckets: 1, schemaVersion: 1, turn: 1 }, sort: { turn: -1 } }
          ),
      ]);
    const currentTurn = finite(gameState?.currentTurn);
    const corporationById = new Map(corporations.map((corp) => [corp._id.toString(), corp]));
    const economicByCorporation = new Map<
      string,
      { revenueAnchor: number; profitAnchor: number }
    >();
    const coverage = {
      sectorRows: 0,
      physicalPnlRows: 0,
      missingPhysicalPnlRows: 0,
      stalePhysicalPnlRows: 0,
      orphanSectorRows: 0,
    };
    const sectors = db.collection<CorporateSector>("corporateSectors").find(
      {},
      {
        projection: {
          corporationId: 1,
          countryId: 1,
          stateId: 1,
          "plantsPnl.revenue": 1,
          "plantsPnl.profit": 1,
          "plantsPnl.turn": 1,
        },
      }
    );
    for await (const sector of sectors) {
      coverage.sectorRows++;
      const id = sector.corporationId.toString();
      const corporation = corporationById.get(id) ?? null;
      if (!corporation) coverage.orphanSectorRows++;
      if (!sector.plantsPnl) {
        coverage.missingPhysicalPnlRows++;
        continue;
      }
      coverage.physicalPnlRows++;
      if (currentTurn > 0 && sector.plantsPnl.turn !== currentTurn) coverage.stalePhysicalPnlRows++;
      const currency = resolveSectorHostCurrencyCode(sector, corporation);
      const rate = fxRateForSectorHostFromMap(sector, corporation, fxByCurrency);
      const current = economicByCorporation.get(id) ?? { revenueAnchor: 0, profitAnchor: 0 };
      current.revenueAnchor += readCorpEconomicAnchor(
        finite(sector.plantsPnl.revenue),
        currency,
        rate
      );
      current.profitAnchor += readCorpEconomicAnchor(
        finite(sector.plantsPnl.profit),
        currency,
        rate
      );
      economicByCorporation.set(id, current);
    }

    const rows: CorporationAuditInput[] = corporations.map((corporation) => {
      const economics = economicByCorporation.get(corporation._id.toString()) ?? {
        revenueAnchor: 0,
        profitAnchor: 0,
      };
      const rate = fxRateForSectorHostFromMap(null, corporation, fxByCurrency);
      const rawMarketCap = finite(corporation.sharePrice) * finite(corporation.totalShares);
      return {
        id: corporation._id.toString(),
        ceoType: corporation.ceoType ?? null,
        ceoVacant: corporation.ceoVacant,
        countryOwnerId: corporation.countryOwnerId ?? null,
        ownershipState: corporation.ownershipState ?? null,
        userId: corporation.userId?.toString() ?? null,
        ...economics,
        marketCapAnchor:
          finite(corporation.totalShares) > 0
            ? readCorpEconomicAnchor(rawMarketCap, corporation.liquidCurrencyCode, rate)
            : null,
      };
    });

    const output = {
      generatedAt: new Date().toISOString(),
      turn: currentTurn,
      source:
        "corporations + corporateSectors.plantsPnl + nppMarketEntryFunnels/current + capacityDecisionFunnels/latest",
      coverage,
      latestCapacityDecisionFunnel: capacityDecisions,
      latestNppEntryFunnel: entryFunnel
        ? {
            schemaVersion: entryFunnel.schemaVersion,
            turn: entryFunnel.turn,
            corporationsObserved: entryFunnel.corporationsObserved,
            entered: entryFunnel.entered,
            rejected: entryFunnel.rejected,
            reasonCounts: entryFunnel.reasonCounts,
          }
        : null,
      ...buildCorporationBalanceAudit(rows),
    };
    process.stdout.write(
      `${JSON.stringify(output, null, process.argv.includes("--pretty") ? 2 : 0)}\n`
    );
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
