import { constantPriceOutput } from "./rules/outputVolume";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { warDamageByCountry, type WarDamage } from "@/lib/military/warDamage";
import type { CorporateSector, UnownedSector, Corporation } from "@/lib/db/types";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  fxRateForSectorHostFromMap,
  loadValuationFxRates,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FiscalRatios } from "./fiscalMirror";
import type { GameConfig } from "@/lib/db/types";
import { isMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";

/**
 * A cross-collection rollup computed once per turn and fed to registry nodes
 * via `{provider: "<name>"}` inputs (spec P0 R1). Nodes never do their own
 * cross-collection DB reads — that is what keeps "add a metric = add an entry"
 * true for sector/stock-integrating nodes.
 */
export interface ExternalAggregateProvider<T> {
  name: string;
  run(db: Db): Promise<T>;
}

export interface SectorRevenueTax {
  /** Per-state owned-sector revenue (FX-normalized to ₳) + growth rate. */
  ownedByState: Map<
    string,
    Array<{
      revenue: number;
      currentGrowthRate: number;
      sectorType?: CorporationType;
      realizedRevenue?: number;
      /** Host-currency nameplate — plants GDP signal (ticket #1084). */
      hostRevenue: number;
      /** Host-currency realized revenue when the sector has one. */
      hostRealizedRevenue?: number;
      outputVolume?: number;
    }>
  >;
  /** Per-state unowned-sector revenue (₳-native). */
  unownedByState: Map<string, Array<{ revenue: number; sectorType?: CorporationType }>>;
  /** Federal sales-tax rate by countryId. */
  federalSalesTaxByCountry: Map<string, number>;
  /** State sales-tax rate by stateId. */
  stateSalesTaxByState: Map<string, number>;
  /**
   * P2/D7: `marketSystemMode >= "plants"`. Read here (the provider layer) so the
   * `sectorGrowth` node never touches gameConfig itself — same rule as every
   * other cross-collection read. Under plants the node swaps the vestigial
   * `currentGrowthRate` average for the realized-revenue delta.
   */
  plantsEnabled: boolean;
}

function finiteRate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Lifted verbatim from gdpGrowth.ts:160-317 (the cross-collection reads + FX
 * normalization + tax-rate maps), behind the provider interface so the gdpGrowth
 * node consumes it instead of reading collections itself. Behavior-preserving:
 * the golden-master fixtures (R2) assert identical downstream results.
 */
export async function sectorRevenueTaxProvider(db: Db, turn = 0): Promise<SectorRevenueTax> {
  const [
    ownedSectors,
    unownedSectors,
    corporations,
    fxByCurrency,
    federalBudgets,
    stateBudgets,
    marketConfig,
  ] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({})
      .project<
        Pick<
          CorporateSector,
          | "_id"
          | "stateId"
          | "revenue"
          | "realizedRevenue"
          | "producedUnits"
          | "strategyId"
          | "transitionFromStrategyId"
          | "transitionStartTurn"
          | "currentGrowthRate"
          | "growthRate"
          | "corporationId"
          | "sectorType"
          | "countryId"
        >
      >({
        stateId: 1,
        countryId: 1,
        revenue: 1,
        // P2/D7: the plants realized-revenue signal (and the baseline snapshot
        // the phase persists) must read what the sector ACTUALLY earned. Under
        // plants `revenue` is the capacity NAMEPLATE (capacity × mixPrice) and
        // capacity only depreciates, so a nameplate-based delta reads a
        // permanent ~-2.4%/yr recession that no player action caused.
        realizedRevenue: 1,
        producedUnits: 1,
        strategyId: 1,
        transitionFromStrategyId: 1,
        transitionStartTurn: 1,
        currentGrowthRate: 1,
        // P3c: the environment tier derives the carbon mix from sector types.
        sectorType: 1,
        // Legacy fallback for pre-split sectors — without this projection,
        // undefined × revenue poisons the weighted average with NaN.
        growthRate: 1,
        corporationId: 1,
      })
      .toArray(),
    db
      .collection<UnownedSector>("unownedSectors")
      .find({})
      .project<Pick<UnownedSector, "_id" | "stateId" | "revenue" | "sectorType">>({
        stateId: 1,
        revenue: 1,
        sectorType: 1,
      })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({})
      .project<Pick<Corporation, "_id" | "countryId">>({
        _id: 1,
        countryId: 1,
      })
      .toArray(),
    loadValuationFxRates(db),
    db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .project<Pick<FederalBudget, "_id" | "countryId" | "taxRates">>({
        countryId: 1,
        taxRates: 1,
      })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({})
      .project<Pick<StateBudget, "_id" | "taxRates">>({
        taxRates: 1,
      })
      .toArray(),
    // P2/D7: market mode via the SAME db handle (mock-db safe — mirrors the
    // labourSystemMode read in the engine phase), not the global getDb().
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { marketSystemMode: 1 } })
      .catch(() => null),
  ]);

  const plantsEnabled = marketAtLeast(
    isMarketSystemMode(marketConfig?.marketSystemMode) ? marketConfig.marketSystemMode : "off",
    "plants"
  );

  // Host-currency lookup: sector economic fields are stored in the HOST state's
  // currency (PR #3466), not the owning corp's. Convert to ₳ with the host rate
  // so a foreign owner's FX cannot revalue host-market earnings. Raw host
  // amounts ride along for the plants GDP signal, which must compare
  // host-to-host so FX noise cannot annualize into phantom growth (#1084).
  const corpById = new Map(corporations.map((c) => [c._id.toString(), c]));

  const ownedByState = new Map<
    string,
    Array<{
      revenue: number;
      realizedRevenue?: number;
      hostRevenue: number;
      hostRealizedRevenue?: number;
      outputVolume?: number;
      currentGrowthRate: number;
      sectorType?: CorporationType;
    }>
  >();
  const unownedByState = new Map<
    string,
    Array<{ revenue: number; sectorType?: CorporationType }>
  >();

  for (const sector of ownedSectors) {
    const corpKey = sector.corporationId?.toString();
    const corp = corpKey ? corpById.get(corpKey) : undefined;
    const hostCode = resolveSectorHostCurrencyCode(sector, corp);
    const hostRate = fxRateForSectorHostFromMap(sector, corp, fxByCurrency);
    const hostRevenue =
      typeof sector.revenue === "number" && Number.isFinite(sector.revenue) ? sector.revenue : 0;
    const hostRealized =
      typeof sector.realizedRevenue === "number" && Number.isFinite(sector.realizedRevenue)
        ? sector.realizedRevenue
        : undefined;
    const revenueAnchor = readCorpEconomicAnchor(hostRevenue, hostCode, hostRate);
    const realizedAnchor =
      hostRealized !== undefined
        ? readCorpEconomicAnchor(hostRealized, hostCode, hostRate)
        : undefined;
    const outputVolume = plantsEnabled ? constantPriceOutput(sector, turn) : null;
    const list = ownedByState.get(sector.stateId) ?? [];
    // Fallback chain: new field → legacy field → 0 (undefined would propagate NaN).
    const growth = sector.currentGrowthRate ?? sector.growthRate ?? 0;
    list.push({
      revenue: revenueAnchor,
      ...(realizedAnchor !== undefined ? { realizedRevenue: realizedAnchor } : {}),
      hostRevenue,
      ...(hostRealized !== undefined ? { hostRealizedRevenue: hostRealized } : {}),
      ...(outputVolume !== null ? { outputVolume } : {}),
      currentGrowthRate: growth,
      sectorType: sector.sectorType,
    });
    ownedByState.set(sector.stateId, list);
  }

  for (const sector of unownedSectors) {
    const list = unownedByState.get(sector.stateId) ?? [];
    list.push({ revenue: sector.revenue, sectorType: sector.sectorType });
    unownedByState.set(sector.stateId, list);
  }

  const federalSalesTaxByCountry = new Map<string, number>();
  for (const budget of federalBudgets) {
    const countryId =
      budget.countryId || (String(budget._id) === "federal" ? "US" : String(budget._id));
    federalSalesTaxByCountry.set(countryId, finiteRate(budget.taxRates?.salesTax));
  }

  const stateSalesTaxByState = new Map<string, number>();
  for (const budget of stateBudgets) {
    stateSalesTaxByState.set(String(budget._id), finiteRate(budget.taxRates?.salesTax));
  }

  return {
    ownedByState,
    unownedByState,
    federalSalesTaxByCountry,
    stateSalesTaxByState,
    plantsEnabled,
  };
}

export const SECTOR_REVENUE_TAX_PROVIDER: ExternalAggregateProvider<SectorRevenueTax> = {
  name: "sectorRevenueTax",
  run: sectorRevenueTaxProvider,
};

/**
 * Provider #2 (P4): the sitting government's stored national approval per
 * country (`governmentApprovals` — the canonical store). Read LAST turn's
 * snapshot by construction (the approval phase writes after the metric
 * engine), which is what keeps the approval↔trust feedback loop a damped
 * cross-turn cycle rather than a same-turn one.
 */
export async function governmentApprovalProvider(db: Db): Promise<Map<string, number>> {
  const docs = await db
    .collection<{ _id: string; approvalRating?: number }>("governmentApprovals")
    .find({})
    .project<{ _id: string; approvalRating?: number }>({ approvalRating: 1 })
    .toArray();
  const byCountry = new Map<string, number>();
  for (const doc of docs) {
    if (typeof doc.approvalRating === "number" && Number.isFinite(doc.approvalRating)) {
      byCountry.set(String(doc._id), doc.approvalRating);
    }
  }
  return byCountry;
}

export const GOVERNMENT_APPROVAL_PROVIDER: ExternalAggregateProvider<Map<string, number>> = {
  name: "governmentApproval",
  run: governmentApprovalProvider,
};

const clampRange = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Provider #3 (📊 budget-sync): per-country real fiscal ratios from
 * `federalBudget`, so the readout metrics (debtToGdp / budgetBalance /
 * schuldenbremseHeadroom) MIRROR reality instead of drifting from a seed.
 * debtToGdp uses the canonical `deriveFiscalState` math (smoothed GDP), so it
 * doesn't depend on `treasuryTurn` field freshness or phase order. Clamped to the
 * metric bounds here; `fiscalMirror` only rounds + persist-gates downstream.
 */
export async function fiscalRatiosProvider(db: Db): Promise<Map<string, FiscalRatios>> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({})
    .project<
      Pick<
        FederalBudget,
        | "_id"
        | "countryId"
        | "treasuryBalance"
        | "gdp"
        | "gdpSmoothed"
        | "debt"
        | "revenue"
        | "spending"
        | "investorConfidence"
      >
    >({
      countryId: 1,
      treasuryBalance: 1,
      gdp: 1,
      gdpSmoothed: 1,
      debt: 1,
      revenue: 1,
      spending: 1,
      investorConfidence: 1,
    })
    .toArray();

  const byCountry = new Map<string, FiscalRatios>();
  for (const b of budgets) {
    const countryId = b.countryId || (String(b._id) === "federal" ? "US" : String(b._id));
    const gdp = b.gdp ?? 0;
    const gdpForRatio = b.gdpSmoothed && b.gdpSmoothed > 0 ? b.gdpSmoothed : gdp;
    const revenue = b.revenue?.total ?? 0;
    const spending = b.spending?.total ?? 0;

    const { debtToGdpRatio } = deriveFiscalState({
      treasuryBalance: b.treasuryBalance ?? -(b.debt?.principal ?? 0),
      gdp,
      gdpSmoothed: b.gdpSmoothed,
      ceiling: b.debt?.ceiling ?? 0,
      investorConfidence: b.investorConfidence,
    });

    const budgetBalance = gdpForRatio > 0 ? ((revenue - spending) / gdpForRatio) * 100 : 0;
    const structuralDeficitPctGdp =
      gdpForRatio > 0 ? (Math.max(0, spending - revenue) / gdpForRatio) * 100 : 0;

    byCountry.set(countryId, {
      debtToGdp: clampRange(debtToGdpRatio * 100, 0, 300),
      budgetBalance: clampRange(budgetBalance, -100, 100),
      schuldenbremseHeadroom: clampRange(0.35 - structuralDeficitPctGdp, -1, 1),
    });
  }
  return byCountry;
}

export const FISCAL_RATIOS_PROVIDER: ExternalAggregateProvider<Map<string, FiscalRatios>> = {
  name: "fiscalRatios",
  run: fiscalRatiosProvider,
};

/**
 * Organizations whose membership confers an *economic* bloc (common market /
 * four freedoms) — members trade more freely with each other → higher
 * `tradeGrowth`. Extend as economic unions are added. (NATO/UN are not economic.)
 */
const ECONOMIC_BLOC_ORG_IDS = new Set<string>(["EU"]);

/**
 * Per-country external inputs to the `economic.tradeGrowth` and `economic.wageGrowth`
 * nodes (P0-R1 — nodes never read collections themselves). Tariffs + foreign-corp
 * tax come from `federalBudget.taxRates`; `forexStrength` = how far the currency has
 * weakened vs its base (weak = export-competitive); `ftaPartnerCount` from the
 * enacted org-FTA SSOT (`loadActiveFtaPairs`, the same source inflation uses); bloc
 * membership from `organizationMemberships`. `inflationRate` is the LAGGED inflation
 * the last `fiscalYear` persisted onto `economicFactors` — `wageGrowth` passes a
 * fraction of it through to nominal wages WITHOUT re-reading it same-turn (the
 * cross-turn lag is what keeps the wage↔inflation loop a damped cycle, not a
 * same-turn feedback). Both nodes share this one provider so `federalBudget` is read
 * once.
 */
export interface FiscalTradeInputs {
  tariff: number; // %
  foreignCorporateTax: number; // %
  forexStrength: number; // rate/baseRate − 1 (>0 = weaker = more export-competitive)
  ftaPartnerCount: number;
  blocMember: boolean;
  inflationRate: number; // % — lagged (last fiscalYear's persisted economicFactors.inflationRate)
}

export async function fiscalTradeInputsProvider(db: Db): Promise<Map<string, FiscalTradeInputs>> {
  const [budgets, exRates, ftaPairs, memberships] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .project<Pick<FederalBudget, "_id" | "countryId" | "taxRates" | "economicFactors">>({
        countryId: 1,
        taxRates: 1,
        economicFactors: 1,
      })
      .toArray(),
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({})
      .project<Pick<ExchangeRate, "_id" | "countryId" | "rate" | "baseRate">>({
        countryId: 1,
        rate: 1,
        baseRate: 1,
      })
      .toArray(),
    loadActiveFtaPairs(db), // enacted org `free_trade_agreement` legislation (SSOT)
    db
      .collection<OrganizationMembership>("organizationMemberships")
      .find({})
      .project<Pick<OrganizationMembership, "_id" | "countryId" | "organizationId">>({
        countryId: 1,
        organizationId: 1,
      })
      .toArray(),
  ]);

  // FTA partner count per country (each pair key is "A|B").
  const ftaCount = new Map<string, number>();
  for (const key of ftaPairs) {
    for (const c of key.split("|")) ftaCount.set(c, (ftaCount.get(c) ?? 0) + 1);
  }

  // Economic-bloc membership.
  const bloc = new Set<string>();
  for (const m of memberships) {
    if (ECONOMIC_BLOC_ORG_IDS.has(String(m.organizationId))) bloc.add(String(m.countryId));
  }

  // Currency weakness (export competitiveness).
  const forex = new Map<string, number>();
  for (const e of exRates) {
    const id = e.countryId || String(e._id);
    if (typeof e.rate === "number" && typeof e.baseRate === "number" && e.baseRate > 0) {
      forex.set(id, e.rate / e.baseRate - 1);
    }
  }

  const byCountry = new Map<string, FiscalTradeInputs>();
  for (const b of budgets) {
    const countryId = b.countryId || (String(b._id) === "federal" ? "US" : String(b._id));
    byCountry.set(countryId, {
      tariff: b.taxRates?.tariffs ?? 0,
      foreignCorporateTax: b.taxRates?.foreignCorporateTax ?? 0,
      forexStrength: forex.get(countryId) ?? 0,
      ftaPartnerCount: ftaCount.get(countryId) ?? 0,
      blocMember: bloc.has(countryId),
      // Lagged: last fiscalYear's persisted inflation (default 2% when unseeded).
      inflationRate: b.economicFactors?.inflationRate ?? 2,
    });
  }
  return byCountry;
}

export const FISCAL_TRADE_INPUTS_PROVIDER: ExternalAggregateProvider<
  Map<string, FiscalTradeInputs>
> = {
  name: "fiscalTradeInputs",
  run: fiscalTradeInputsProvider,
};

/**
 * War damage per country, for the infrastructure nodes.
 *
 * One small read of the live conflicts per turn, shaped by the pure
 * `warDamageByCountry`. Countries at peace, nearly all of them nearly always,
 * are simply absent from the map and the consuming nodes fall through to zero.
 */
export async function warDamageProvider(db: Db): Promise<Map<string, WarDamage>> {
  const conflicts = await db
    .collection<ConflictDoc>("conflicts")
    .find({ status: { $ne: "resolved" } })
    .project<
      Pick<ConflictDoc, "status" | "hostCountry" | "hostEntities" | "control" | "controlStart">
    >({ status: 1, hostCountry: 1, hostEntities: 1, control: 1, controlStart: 1 })
    .toArray();
  return warDamageByCountry(conflicts);
}
