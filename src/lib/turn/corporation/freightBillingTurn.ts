/**
 * Canonical freight billing v1 (issue #897): the corporation-turn glue between
 * last turn's state-scoped shipping money (lookups, from the sourcing pass via
 * sourcingNetworkLoad) and the per-sector apportionment in
 * `@/lib/logistics/freightBilling`.
 *
 * This file owns exactly one job: derive each sector's billing-relevant
 * physical units the same way every other corp surface does
 * (`computeSectorCommodityUnits`, the ledger's per-sector twin) and hand the
 * pure apportionment its inputs. Only called while
 * `gameConfig.canonicalFreightBillingEnabled` is on; a world with the flag off
 * never reaches this code.
 */

import type { Corporation, CorporateSector } from "@/lib/db/types";
import { computeSectorCommodityUnits } from "@/lib/corporations/corpCommodityFlows";
import {
  apportionFreightBilling,
  type FreightBillingApportionment,
  type FreightBillingSectorUnits,
} from "@/lib/logistics/freightBilling";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import {
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MarketContext } from "@/lib/market/marketContext";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { CorporationLookups } from "./types";

/**
 * Apportion last turn's freight charges and haul revenue across every sector.
 *
 * Reads only `lookups` plus per-world context; writes nothing. Sectors are
 * measured on the same chain as the world ledger (planned-economy remap,
 * extraction capacity filter, plants production, mothball = cold), so the
 * sector that the ledger says demanded the steel is the sector that pays its
 * shipping, and the sector whose freight supply carried the haul is the one
 * paid for it.
 */
export function buildFreightBillingBySector(args: {
  lookups: Pick<
    CorporationLookups,
    | "sectorsByCorp"
    | "corpById"
    | "eraUnitScale"
    | "exchangeRatesByCurrency"
    | "stateResourceCapacityByState"
    | "freightChargesByDestState"
    | "freightHaulRevenueByOriginState"
  >;
  currentTurn: number;
  plantsEnabled: boolean;
  currentYear: number | null | undefined;
  commandEconomyEnabled: boolean;
}): FreightBillingApportionment {
  const { lookups, currentTurn, plantsEnabled, currentYear, commandEconomyEnabled } = args;
  const freightChargesByDestState = lookups.freightChargesByDestState ?? new Map();
  const haulRevenueByOriginState = lookups.freightHaulRevenueByOriginState ?? new Map();

  const sectors: FreightBillingSectorUnits[] = [];
  if (freightChargesByDestState.size > 0 || haulRevenueByOriginState.size > 0) {
    for (const [corpId, corpSectors] of lookups.sectorsByCorp) {
      const corp: Corporation | undefined = lookups.corpById.get(corpId);
      const isNatcorp = !!corp?.countryOwnerId;
      for (const sector of corpSectors as CorporateSector[]) {
        if (!sector.stateId) continue;
        // Cheap pre-filter: only sectors in a state that owes or earned money
        // this turn need their units derived.
        const stateCharges = freightChargesByDestState.get(sector.stateId);
        const stateRevenue = haulRevenueByOriginState.get(sector.stateId) ?? 0;
        if (!stateCharges && !(stateRevenue > 0)) continue;
        const hostCode = resolveSectorHostCurrencyCode(sector, corp);
        const hostRate = fxRateForSectorHostFromMap(sector, corp, lookups.exchangeRatesByCurrency);
        const units = computeSectorCommodityUnits(
          {
            ...sector,
            revenueAnchor: readCorpEconomicAnchor(sector.revenue, hostCode, hostRate),
            producedUnits: sector.producedUnits,
            capacityUnits: sector.capitalStock,
          },
          currentTurn,
          {
            plantsEnabled,
            isNatcorp,
            eraUnitScale: lookups.eraUnitScale,
            currentYear,
            commandEconomyEnabled,
            stateResourcesByState: lookups.stateResourceCapacityByState,
          }
        );
        // Zero-demand/zero-supply sectors still enter: the apportionment
        // ignores them per commodity, and dropping them here would change
        // nothing except hiding the identity from tests.
        sectors.push({
          sectorId: sector._id.toString(),
          stateId: sector.stateId,
          demandUnitsByCommodity: units.demand,
          freightSupplyUnits: units.supply.get("freight") ?? 0,
        });
      }
    }
  }

  return apportionFreightBilling({
    freightChargesByDestState,
    haulRevenueByOriginState,
    sectors,
  });
}

/**
 * A sector's two freight billing legs plus the `$set` payload that persists
 * them, resolved from the market context maps the corp-phase entry populated.
 *
 * ₳/turn on `charge`/`credit` (they ride the sector's cost and revenue rails);
 * the persisted lines are on the same daily basis and host currency as
 * `revenue` / `laborCost`, so a later financials bridge can show "freight"
 * instead of a blended haircut. Only billing worlds populate the maps, so a
 * world with the flag off writes nothing new, except to clear a value it
 * wrote while billing was on, which would otherwise sit stale on the sector
 * forever (deliveryLimitedFraction precedent). A legacy-mothballed (embargoed
 * foreign) sector neither earns nor bleeds while dormant, matching the
 * sector's `costs` leg.
 */
export function resolveSectorFreightBillingLegs(args: {
  market: Pick<MarketContext, "freightBillingChargeBySectorId" | "freightBillingCreditBySectorId">;
  sector: Pick<CorporateSector, "_id" | "freightBillingCharge" | "freightBillingCredit">;
  embargoLegacyMothball: boolean;
  currentTurn: number;
  sectorCurrencyCode: CurrencyCode | undefined;
  sectorFxRate: number;
}): { charge: number; credit: number; sectorUpdate: Record<string, unknown> } {
  const { market, sector, embargoLegacyMothball, currentTurn, sectorCurrencyCode, sectorFxRate } =
    args;
  const sectorId = sector._id.toString();
  const charge = embargoLegacyMothball
    ? 0
    : (market.freightBillingChargeBySectorId?.get(sectorId) ?? 0);
  const credit = embargoLegacyMothball
    ? 0
    : (market.freightBillingCreditBySectorId?.get(sectorId) ?? 0);
  const active =
    market.freightBillingChargeBySectorId != null || market.freightBillingCreditBySectorId != null;
  const sectorUpdate: Record<string, unknown> = {};
  if (active) {
    sectorUpdate.freightBillingCharge = writeCorpEconomicLocal(
      charge * TURNS_PER_DAY,
      sectorCurrencyCode,
      sectorFxRate
    );
    sectorUpdate.freightBillingCredit = writeCorpEconomicLocal(
      credit * TURNS_PER_DAY,
      sectorCurrencyCode,
      sectorFxRate
    );
    sectorUpdate.freightBillingTurn = currentTurn;
  } else if (
    typeof sector.freightBillingCharge === "number" ||
    typeof sector.freightBillingCredit === "number"
  ) {
    sectorUpdate.freightBillingCharge = 0;
    sectorUpdate.freightBillingCredit = 0;
  }
  return { charge, credit, sectorUpdate };
}
