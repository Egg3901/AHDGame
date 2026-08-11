// Shared, read-only "what will this nationalization take" computations used by
// BOTH the bill provision editor's live preview (proposal modal) AND the enacted
// bill detail view. Keeping the estimate in one place stops the editor preview,
// the bill view, and the engine from drifting apart (e.g. the re-nationalization
// cooldown skip — see spec §13.4).
import type { Db, ObjectId } from "mongodb";
import type { CentralBank, Character, Corporation, CorporateSector, State } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { buildPrimeRateMap, computeSectorNpvSum } from "@/lib/bonds/corporateBondDefault";
import { applyTier, sectorCompensationValuationAnchor } from "./compensation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { isStateOwned } from "./nationalCorporation";
import { isWithinRenationalizeCooldown } from "./privatizationShares";
import { resolveCorpEligibility } from "./targetEligibility";
import type { SectorScope } from "./nationalizeSectorWide";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export interface SectorPreviewAffectedCorp {
  corporationId: string;
  name: string;
  regionCount: number;
  sectorCount: number;
  estCompensationLocal: number;
}

export interface SectorNationalizationPreview {
  sectorType: CorporationType;
  carveFraction: number;
  scope: SectorScope;
  currency: CurrencyCode;
  affectedCorps: SectorPreviewAffectedCorp[];
  affectedCount: number;
  totalCompensationLocal: number;
  unownedSliceRevenuePerTurn: number;
}

/**
 * Estimate an industry-wide sector taking: the affected (non-state-owned, not
 * cooldown-locked) corporations and their treasury compensation in country
 * currency, plus the free unowned-market slice. Mirrors the skips
 * `nationalizeSectorWide` applies so the estimate matches what is actually taken.
 */
export async function computeSectorNationalizationPreview(
  db: Db,
  params: {
    countryId: CountryId;
    sectorType: CorporationType;
    carveFraction: number;
    scope: SectorScope;
    currentTurn: number;
  }
): Promise<SectorNationalizationPreview> {
  const { countryId, sectorType, scope, currentTurn } = params;
  const f = Math.min(1, Math.max(0, params.carveFraction));
  const countryCurrency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;

  const [centralBanks, fxByCurrency, marketMode, previewGameState] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const primeMap = buildPrimeRateMap(centralBanks);
  // D11: the preview must use the SAME base + premium the engine will pay, or
  // the quoted treasury cost diverges from the actual debit under plants.
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const previewCurrentYear = previewGameState?.currentYear;
  const previewEraUnitScale = await loadWorldEraUnitScale(db);
  const countryRate = fxByCurrency.get(countryCurrency) ?? 1;
  const toCountryLocal = (anchor: number) =>
    Math.round(writeGovBudgetLocal(anchor, countryCurrency, countryRate));

  const affectedCorps: SectorPreviewAffectedCorp[] = [];
  let totalCompensationAnchor = 0;
  let unownedSliceRevenue = 0;

  // ── Corp-held pool ──
  if (scope !== "unowned" && f > 0) {
    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ countryId, sectorType })
      .toArray();
    const byCorp = new Map<string, CorporateSector[]>();
    for (const s of sectors) {
      const k = String(s.corporationId);
      byCorp.set(k, [...(byCorp.get(k) ?? []), s]);
    }
    // One fetch for every corp holding a sector in this pool; this was a
    // findOne per corp inside the loop below.
    const corpDocs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: [...byCorp.values()].map((s) => s[0].corporationId) } })
      .toArray();
    const corpById = new Map(corpDocs.map((c) => [String(c._id), c]));

    for (const [corpKey, corpSectors] of byCorp) {
      const corp = corpById.get(String(corpSectors[0].corporationId)) ?? null;
      if (!corp || isStateOwned(corp)) continue;
      // #89: npp_unowned scope carves only NPP-run corps — mirror the engine skip
      // so the previewed affected-corp list matches what is actually taken.
      if (scope === "npp_unowned" && corp.ceoType !== "npp") continue;
      if (isWithinRenationalizeCooldown(corp, currentTurn)) continue;
      let corpAnchor = 0;
      const regions = new Set<string>();
      for (const sec of corpSectors) {
        corpAnchor += applyTier(
          // Steady-state valuation so the previewed treasury cost matches the
          // payout the engine pays (excludes discretionary growth cost).
          sectorCompensationValuationAnchor(
            sec,
            computeSectorNpvSum([sec], primeMap, corp, fxByCurrency, {
              excludeGrowthCost: true,
              plantsEnabled,
            }),
            {
              plantsEnabled,
              currentYear: previewCurrentYear,
              fraction: f,
              eraUnitScale: previewEraUnitScale,
            }
          ),
          "fair",
          { plantsEnabled }
        );
        regions.add(sec.stateId);
      }
      totalCompensationAnchor += corpAnchor;
      affectedCorps.push({
        corporationId: corpKey,
        name: corp.name,
        regionCount: regions.size,
        sectorCount: corpSectors.length,
        estCompensationLocal: toCountryLocal(corpAnchor),
      });
    }
    affectedCorps.sort((a, b) => b.estCompensationLocal - a.estCompensationLocal);
  }

  // ── Unowned market pool (free) ──
  if (scope !== "corporations" && f > 0) {
    const unowned = await db
      .collection<UnownedSector>("unownedSectors")
      .find({ countryId, sectorType })
      .toArray();
    for (const u of unowned) unownedSliceRevenue += Math.round((u.revenue ?? 0) * f);
  }

  return {
    sectorType,
    carveFraction: f,
    scope,
    currency: countryCurrency,
    affectedCorps,
    affectedCount: affectedCorps.length,
    totalCompensationLocal: toCountryLocal(totalCompensationAnchor),
    unownedSliceRevenuePerTurn: unownedSliceRevenue,
  };
}

export interface NationalizationTargetSector {
  sectorType: CorporateSector["sectorType"];
  stateName: string;
  revenuePerTurn: number;
}

export interface NationalizationTargetDetail {
  name: string;
  ownerKind: "player" | "npc";
  triggers: string[];
  eligible: boolean;
  isDistressed: boolean;
  executivelyTakeable: boolean;
  hqStateName: string;
  sectorCount: number;
  regionCount: number;
  totalRevenuePerTurn: number;
  avgGrowthPct: number;
  avgProductionPct: number;
  sectors: NationalizationTargetSector[];
  marketCapLocal: number;
  liquidCapitalLocal: number;
  currency: CurrencyCode;
  ceoVacant: boolean;
  ceoName: string | null;
}

/**
 * Nationalization-relevant detail for ONE corporation: owner kind, eligibility
 * triggers, per-region sectors, performance averages, value. The corp is loaded
 * + validated by the caller (route / enrichment).
 */
export async function computeNationalizationTargetDetail(
  db: Db,
  countryId: CountryId,
  corp: Corporation,
  currentTurn: number
): Promise<NationalizationTargetDetail> {
  const elig = await resolveCorpEligibility(db, countryId, corp, currentTurn);

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corp._id })
    .project<{
      sectorType: CorporateSector["sectorType"];
      stateId: string;
      revenue: number;
      currentGrowthRate?: number;
      productionPolicyLevel?: number;
    }>({ sectorType: 1, stateId: 1, revenue: 1, currentGrowthRate: 1, productionPolicyLevel: 1 })
    .toArray();

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const avgGrowthPct = sectors.length
    ? round1(sectors.reduce((s, x) => s + (x.currentGrowthRate ?? 0), 0) / sectors.length)
    : 0;
  const avgProductionPct = sectors.length
    ? round1(sectors.reduce((s, x) => s + (x.productionPolicyLevel ?? 0), 0) / sectors.length)
    : 0;

  const stateIds = [...new Set(sectors.map((s) => s.stateId).concat(corp.headquartersState))];
  const stateDocs =
    stateIds.length > 0
      ? await db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : [];
  const stateName = new Map(stateDocs.map((s) => [String(s._id), s.name]));
  const regionName = (id: string | undefined) => (id && stateName.get(id)) || id || "—";

  let ceoName: string | null = null;
  if (!corp.ceoVacant && corp.ceoId) {
    const ceo = await db
      .collection<Character>("characters")
      .findOne({ _id: corp.ceoId }, { projection: { name: 1 } });
    ceoName = ceo?.name ?? null;
  }

  const currency = (corp.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[countryId] ??
    "USD") as CurrencyCode;

  return {
    name: corp.name,
    ownerKind: elig.ownerKind,
    triggers: elig.result.triggers,
    eligible: elig.result.eligible,
    isDistressed: elig.result.isDistressed,
    executivelyTakeable: elig.executivelyTakeable,
    hqStateName: regionName(corp.headquartersState),
    sectorCount: sectors.length,
    regionCount: new Set(sectors.map((s) => s.stateId)).size,
    totalRevenuePerTurn: sectors.reduce((sum, s) => sum + Math.round(s.revenue ?? 0), 0),
    avgGrowthPct,
    avgProductionPct,
    sectors: sectors.map((s) => ({
      sectorType: s.sectorType,
      stateName: regionName(s.stateId),
      revenuePerTurn: Math.round(s.revenue ?? 0),
    })),
    marketCapLocal: Math.max(0, Math.round((corp.sharePrice ?? 0) * (corp.totalShares ?? 0))),
    liquidCapitalLocal: Math.round(corp.liquidCapital ?? 0),
    currency,
    ceoVacant: !!corp.ceoVacant,
    ceoName,
  };
}

/**
 * "What will this nationalization take" detail for one provision. Computed live
 * for proposed bills; frozen at enactment (stored as `nationalizationSnapshot` on
 * the provision) so a passed bill keeps showing the affected-corp / treasury-cost
 * breakdown as it was when it passed, instead of recomputing to zero once the
 * assets have been taken.
 */
export type NationalizationProvisionDetail = (
  | { kind: "sector"; sector: SectorNationalizationPreview }
  | { kind: "corp"; corp: NationalizationTargetDetail }
) & {
  /**
   * True when this snapshot was reconstructed from a backup taken well before the
   * bill actually passed (a gap in backup coverage), so the figures approximate
   * the real passage-time cost. Set only by the historical backfill; live
   * previews and at-enactment snapshots leave it unset.
   */
  approximate?: boolean;
  /**
   * The compensation the treasury ACTUALLY paid for this taking, in the display
   * currency, read from the permanent `nationalizationLedger`. Set on enacted
   * bills only (a taking has occurred); proposed/pending bills leave it unset.
   * This is the authoritative figure — the estimate above can drift or, for
   * backfilled bills, be approximate.
   */
  actualPayoutLocal?: number;
};

/**
 * Resolve the display detail for one nationalize provision (sector-wide or
 * whole-corp), or `undefined` if it targets nothing renderable. Shared by the
 * bill enrichment (live preview) AND the enactment snapshot so the proposal
 * modal, the bill view, and the frozen record never drift. Takes a structural
 * provision (not the `NationalizeProvision` type) to avoid a circular import with
 * `db/types/legislation`, which references `NationalizationProvisionDetail`.
 */
export async function computeNationalizationProvisionDetail(
  db: Db,
  countryId: CountryId,
  provision: {
    targetSectorType?: CorporationType;
    sectorCarveFraction?: number;
    sectorScope?: SectorScope;
    targetCorporationId?: ObjectId;
  },
  currentTurn: number
): Promise<NationalizationProvisionDetail | undefined> {
  if (provision.targetSectorType) {
    const sector = await computeSectorNationalizationPreview(db, {
      countryId,
      sectorType: provision.targetSectorType,
      carveFraction: provision.sectorCarveFraction ?? 1,
      scope: provision.sectorScope ?? "all",
      currentTurn,
    });
    return { kind: "sector", sector };
  }
  if (provision.targetCorporationId) {
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: provision.targetCorporationId });
    if (corp && corp.countryId === countryId && !isStateOwned(corp)) {
      const corpDetail = await computeNationalizationTargetDetail(db, countryId, corp, currentTurn);
      return { kind: "corp", corp: corpDetail };
    }
  }
  return undefined;
}
