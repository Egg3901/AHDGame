import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { CommodityPrice } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { GameConfig } from "@/lib/db/types";
import type { Tariff } from "@/lib/db/types/tariff";
import { marketAtLeast } from "@/lib/market/featureFlag";
import {
  settleFreightNetwork,
  freightSettlementRampFraction,
  type FreightSettlement,
} from "@/lib/logistics/settlement";
import { buildSourcingDocs, SOURCING_FLOW_RETENTION_TURNS } from "@/lib/logistics/sourcingLedger";
import { stateHops } from "@/lib/logistics/stateDistance";
import { importerTariffOnFlow } from "@/lib/trade/tariffDrag";
import { PRIMARY_SECTOR_BY_COMMODITY } from "@/lib/trade/commoditySector";
import { applyFreightHaulDemand } from "@/lib/logistics/freightDemand";
import type { CommodityType } from "@/lib/constants/commodities";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { CountryLedger, GlobalLedger, StateLedger } from "./ledgerTypes";

export interface FreightSettlementInputs {
  marketSystemMode: Parameters<typeof marketAtLeast>[0];
  allStates: Pick<State, "_id" | "countryId">[];
  stateToCountry: Map<string, string>;
  roadConditionByState: Map<string, number>;
  existingPriceMap: Map<string, CommodityPrice>;
  ledgerBasePrices: Record<CommodityType, number>;
  ledgerEraUnitScale: number;
  tariffDocs: Tariff[];
  ftaPairs: Parameters<typeof importerTariffOnFlow>[1];
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
}

export interface FreightSettlementOutcome {
  freightSettlement: FreightSettlement | null;
  freightRampFraction: number;
  freightSettlementActive: boolean;
}

/**
 * Landed-price freight settlement (shadow or active), run on PRE-clearing
 * balances (preserving those raw balances for aggregate clearing). Determines
 * which sellers each state can buy from at landed price (ask + per-hop
 * freight + tariff), bounded by origin freight capacity. Shadow persists
 * routes only; active additionally persists delivered input availability for
 * the following corporation turn.
 *
 * Ordering constraint: stays above clearAllCommodities/applyTradeConvergence,
 * which relieve byCountry in place. Freight demand (including final requests
 * refused by local capacity) is booked before clearing.
 */
export async function runFreightSettlementPhase(
  db: Db,
  inputs: FreightSettlementInputs,
  turn: number,
  now: Date,
  global: GlobalLedger,
  byState: StateLedger,
  byCountry: CountryLedger
): Promise<FreightSettlementOutcome> {
  const {
    marketSystemMode,
    allStates,
    stateToCountry,
    roadConditionByState,
    existingPriceMap,
    ledgerBasePrices,
    ledgerEraUnitScale,
    tariffDocs,
    ftaPairs,
    affinityFor,
  } = inputs;
  // Freight is a separately-soaked rollout. The market ladder enables the
  // ledger needed to observe routes, while this gate decides whether those
  // deliveries constrain next turn's local plant inputs.
  const freightSettlementConfig = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        freightSettlementMode: 1,
        canonicalFreightBillingEnabled: 1,
        shortageResponsiveSourcingEnabled: 1,
        freightSettlementRampStartTurn: 1,
        freightSettlementRampTurns: 1,
      },
    }
  );
  const freightSettlementActive =
    freightSettlementConfig?.freightSettlementMode === "active" &&
    marketAtLeast(marketSystemMode, "clearing");
  // Gradual freight-settlement ramp (Phase 4): fade the ACTIVE effect in over a
  // configured window instead of a hard balance step. R scales the cap here and
  // the persisted billing money below; unset window → 1 (instant, unchanged).
  const freightRampFraction = freightSettlementRampFraction(freightSettlementConfig, turn);
  // Canonical freight billing v1 (issue #897): while on, the sourcing pass's
  // per-state shipping money aggregates are persisted on the network doc for
  // the next corporation turn to apportion. Off (the default) writes nothing.
  const canonicalFreightBillingEnabled =
    freightSettlementConfig?.canonicalFreightBillingEnabled === true;
  let freightSettlement: FreightSettlement | null = null;

  if (marketAtLeast(marketSystemMode, "ledger")) {
    const sourcingStates = allStates
      .filter((s) => !NATIONAL_SCOPE_IDS.has(s._id) && stateToCountry.has(s._id))
      .map((s) => ({ stateId: s._id, countryId: s.countryId as CountryId }));
    freightSettlement = settleFreightNetwork({
      states: sourcingStates,
      byState,
      byCountry,
      statePricesFor: (commodity) => existingPriceMap.get(commodity)?.statePrices,
      nationalPricesFor: (commodity) => existingPriceMap.get(commodity)?.nationalPrices,
      basePriceFor: (commodity) => ledgerBasePrices[commodity],
      freightPrice: existingPriceMap.get("freight")?.globalPrice ?? ledgerBasePrices.freight,
      eraUnitScale: ledgerEraUnitScale,
      hops: stateHops,
      shippingCostMultiplier: (_country, from, to) => {
        const average =
          ((roadConditionByState.get(from) ?? 60) + (roadConditionByState.get(to) ?? 60)) / 2;
        return Math.max(0.97, Math.min(1.03, 1 - ((average - 60) / 40) * 0.03));
      },
      tariffRatePct: (commodity, exporter, importer) => {
        const sectorType = PRIMARY_SECTOR_BY_COMMODITY[commodity];
        return sectorType
          ? importerTariffOnFlow(tariffDocs, ftaPairs, importer, exporter, sectorType)
          : 0;
      },
      // affinity 0 ⇔ a blocking embargo matches the directed flow.
      isBlocked: (commodity, exporter, importer) =>
        affinityFor(commodity, exporter, importer) === 0,
      shortageResponsiveSourcingEnabled:
        freightSettlementConfig?.shortageResponsiveSourcingEnabled === true,
    });
    const { commodityDocs, networkDoc } = buildSourcingDocs(freightSettlement.sourcing, turn, now, {
      includeFreightBilling: canonicalFreightBillingEnabled,
      billingRampFraction: freightRampFraction,
    });
    if (commodityDocs.length > 0) {
      // Lazy index for the {commodity} + latest-turn read path, mirroring
      // commodityFlows. Fire-and-forget.
      void db
        .collection("commoditySourcingFlows")
        .createIndex({ commodity: 1, turn: -1 })
        .catch(() => {});
      // Upsert by {commodity, turn} so cron retries overwrite rather than append.
      await db.collection("commoditySourcingFlows").bulkWrite(
        commodityDocs.map((doc) => ({
          replaceOne: {
            filter: { commodity: doc.commodity, turn: doc.turn },
            replacement: doc,
            upsert: true,
          },
        }))
      );
    }
    // Player/telemetry indicator: expose the ramp fraction while it is mid-flight
    // so the phase-in is legible on the markets tracker and admin view. Only when
    // an active effect is actually being scaled (mode active or billing on).
    if (
      (freightSettlementActive || canonicalFreightBillingEnabled) &&
      freightRampFraction > 0 &&
      freightRampFraction < 1
    ) {
      networkDoc.freightSettlementRampFraction = Math.round(freightRampFraction * 10000) / 10000;
    }
    await db
      .collection("sourcingNetworkLoad")
      .updateOne({ turn }, { $set: networkDoc }, { upsert: true });
    const sourcingPruneCutoff = turn - SOURCING_FLOW_RETENTION_TURNS;
    if (sourcingPruneCutoff > 0) {
      await Promise.all([
        db.collection("commoditySourcingFlows").deleteMany({ turn: { $lt: sourcingPruneCutoff } }),
        db.collection("sourcingNetworkLoad").deleteMany({ turn: { $lt: sourcingPruneCutoff } }),
      ]);
    }

    // Freight demand wiring (ticket #1039): price-tolerant haul TEU, including
    // the final requests refused by local capacity, is booked before clearing.
    // Observed network load remains separately available as freightTeuByState.
    applyFreightHaulDemand(freightSettlement.sourcing.freightDemandTeuByState, {
      global,
      byState,
      byCountry,
      stateToCountry,
    });
  }

  return { freightSettlement, freightRampFraction, freightSettlementActive };
}
