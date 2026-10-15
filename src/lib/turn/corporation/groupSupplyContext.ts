import { priceRealizationFactor } from "@/lib/market/priceRealization";
/** Group supply uses existing turn snapshots and adds no per-corporation queries or cash transfers. */
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { resolveGroupRows } from "@/lib/corporations/groups/groupMembership";
import { CEO_ARCHETYPE_MODIFIERS } from "@/lib/npp/ceoArchetype";
import { groupOperator } from "@/lib/corporations/groups/operator";
import { computeSupplyAgreementBuyerDemand } from "@/lib/corporations/groups/rules/inputDemand";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import {
  commodityMixWeight,
  eraScaledBasePrices,
  plantsSupplyScaledUnits,
  embargoSupplyFactorFor,
  type CommodityType,
} from "@/lib/constants/commodities";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  fxRateForCorpFromMap,
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";
import { getNppCashFloorAnchor } from "@/lib/turn/npp/nppCashReserve";
import type { CorporationLookups } from "./types";
import type { SettleableSupplyAgreement } from "./settleSupplyAgreements";
import type { computeClearingFactors } from "@/lib/market/clearing";
import type { CoordinationBuyer } from "@/lib/corporations/groups/rules/marketCoordination";
export function buildGroupSupplyContext(
  lookups: CorporationLookups,
  turn: number,
  freightSettlementActive: boolean,
  agreements: readonly SettleableSupplyAgreement[] = [],
  membership?: import("@/lib/corporations/groups/groupMembership").GroupMembership
): NonNullable<Parameters<typeof computeClearingFactors>[0]["groupSupply"]> {
  const groups = membership ?? resolveGroupRows(lookups.corporations);
  const members = lookups.corporations.flatMap((c) => {
    const rootId = groups.rootByCorpId.get(c._id.toString());
    const root = rootId ? lookups.corpById.get(rootId) : undefined;
    if (
      !rootId ||
      !root ||
      root.subsidiaryFormalizedAtTurn != null ||
      root.countryOwnerId ||
      root.suspended ||
      root.ceoVacant ||
      !root.ceoId ||
      !groups.membersByRootId.has(rootId)
    )
      return [];
    const cash = corpCapitalToAnchor(
      c.liquidCapital ?? 0,
      c.liquidCurrencyCode,
      fxRateForCorpFromMap(c, lookups.exchangeRatesByCurrency)
    );
    // Protect a full turn of operating commitments in addition to the NPP reserve.
    const costs = (lookups.sectorsByCorp.get(c._id.toString()) ?? []).reduce((sum, sector) => {
      const revenue = readCorpEconomicAnchor(
        sector.realizedRevenue ?? sector.revenue,
        resolveSectorHostCurrencyCode(sector, c),
        fxRateForSectorHostFromMap(sector, c, lookups.exchangeRatesByCurrency)
      );
      return sum + Math.max(0, (revenue * (1 - (sector.profitMargin ?? 0) / 100)) / TURNS_PER_DAY);
    }, 0);
    return [
      {
        ...groupOperator(c, rootId),
        cashAvailableAnchor: Math.max(
          0,
          cash -
            Math.max(0, costs) -
            (c.ceoType === "npp"
              ? getNppCashFloorAnchor(
                  lookups.preset,
                  Math.max(...Object.values(CEO_ARCHETYPE_MODIFIERS).map((m) => m.cashFloorMult))
                )
              : 0)
        ),
        preference: c.groupReceiving,
        supplyDiscount: root.groupManagement?.supplyDiscount,
      },
    ];
  });
  const activeRoots = new Set(
    lookups.corporations
      .filter((c) => c.groupManagement?.supplyPolicy === "members")
      .map((c) => c._id.toString())
  );
  const forecastByRoot = new Map<
    string,
    import("@/lib/corporations/groups/rules/forecast").GroupForecastBasis
  >();
  for (const [rootId, memberIds] of groups.membersByRootId) {
    if (!members.some((m) => m.rootId === rootId)) continue;
    forecastByRoot.set(rootId, {
      rootId,
      turn,
      memberIds,
      cashByMember: Object.fromEntries(
        members.filter((m) => m.rootId === rootId).map((m) => [m.id, m.cashAvailableAnchor])
      ),
      books: [],
      complete: true,
    });
  }
  const buyersByCommodity = new Map<CommodityType, CoordinationBuyer[]>();
  const locationBySector = new Map<string, { countryId: string; stateId: string }>();
  const physicalBySectorCommodity = new Map<string, Map<CommodityType, number>>();
  const contractedByBuyer = new Map<string, Map<string, number>>();
  for (const agreement of agreements) {
    const rows = contractedByBuyer.get(agreement.buyerCorpId) ?? new Map<string, number>();
    const key = agreement.stateId
      ? agreement.commodity + "@" + agreement.stateId
      : agreement.commodity;
    rows.set(key, (rows.get(key) ?? 0) + agreement.volumeCap);
    contractedByBuyer.set(agreement.buyerCorpId, rows);
  }
  for (const [corpId, sectors] of lookups.sectorsByCorp) {
    const corp = lookups.corpById.get(corpId);
    if (!corp || corp.suspended) continue;
    for (const sector of sectors) {
      const sectorId = sector._id.toString();
      const countryId =
        lookups.stateCountryMap?.get(sector.stateId) ?? sector.countryId ?? corp.countryId ?? "";
      locationBySector.set(sectorId, { countryId, stateId: sector.stateId });
      const revenueAnchor = readCorpEconomicAnchor(
        sector.revenue,
        resolveSectorHostCurrencyCode(sector, corp),
        fxRateForSectorHostFromMap(sector, corp, lookups.exchangeRatesByCurrency)
      );
      const demand = computeSupplyAgreementBuyerDemand({
        preset: lookups.preset,
        hardwareInputReliefStartTurn: lookups.hardwareInputReliefStartTurn,
        currentTurn: turn,
        unitScale: lookups.eraUnitScale,
        plantsEnabled: true,
        sectors: [
          {
            ...sector,
            corporationId: corpId,
            revenueAnchor,
            capacityUnits: sector.operatingCapacityUnits ?? sector.capitalStock,
            isNatcorp: !!corp.countryOwnerId,
          },
        ],
      }).get(corpId);
      for (const [commodity, units] of demand ?? []) {
        if (commodity.includes("@")) continue;
        const contracted = contractedByBuyer.get(corpId);
        // State-addressed obligations consume their lane before a corporation-wide obligation.
        let commitment = 0;
        for (const key of [commodity + "@" + sector.stateId, commodity]) {
          const take = Math.min(Math.max(0, units - commitment), contracted?.get(key) ?? 0);
          commitment += take;
          if (contracted) contracted.set(key, Math.max(0, (contracted.get(key) ?? 0) - take));
        }
        const rows = buyersByCommodity.get(commodity as CommodityType) ?? [];
        rows.push({
          sectorId,
          memberId: corpId,
          countryId,
          stateId: sector.stateId,
          requiredUnits: units,
          contractedUnits: commitment,
          publicPriceFactor: priceRealizationFactor(
            lookups.reachableInputPriceRatiosByCountry
              ?.get(countryId)
              ?.get(commodity as CommodityType) ??
              lookups.priceRatioByCommodity.get(commodity as CommodityType)
          ),
        });
        buyersByCommodity.set(commodity as CommodityType, rows);
      }
      const rates = getEffectiveStrategyRatesForOperatingModel(
        sector.sectorType,
        sector.strategyId ?? "standard",
        sector.transitionFromStrategyId,
        sector.transitionStartTurn,
        turn,
        sector.industryModel,
        sector.mediaDiscriminator,
        lookups.preset
      );
      const output = plantsSupplyScaledUnits({
        producedUnits: sector.mothballed ? 0 : sector.producedUnits,
        isNatcorp: !!corp.countryOwnerId,
        embargoSupplyFactor: embargoSupplyFactorFor(sector),
      });
      const byCommodity = new Map<CommodityType, number>();
      for (const commodity of Object.keys(rates.supply ?? {}) as CommodityType[])
        byCommodity.set(
          commodity,
          Math.max(0, output ?? 0) *
            commodityMixWeight(
              rates.supply ?? {},
              eraScaledBasePrices(lookups.eraUnitScale),
              commodity
            )
        );
      physicalBySectorCommodity.set(sectorId, byCommodity);
    }
  }
  return {
    turn,
    activeRoots,
    localInputAvailabilityByState: lookups.stateInputAvailabilityByState,
    localBalancesByState: lookups.rawStateBalances,
    forecastByRoot,
    freightSettlementActive,
    members,
    buyersByCommodity,
    locationBySector,
    physicalBySectorCommodity,
    receipts: [],
    committedOutputBySector: members.some(
      (m) => activeRoots.has(m.rootId) && (m.supplyDiscount ?? 0) > 0
    )
      ? new Map()
      : undefined,
    availabilityBySector: new Map(),
    inputAllocationsBySector: new Map(),
  };
}
