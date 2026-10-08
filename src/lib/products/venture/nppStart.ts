/**
 * Computer-run companies develop products too. Without this the venture system
 * barely touches the economy, because NPP corporations run most media and
 * manufacturing sectors.
 *
 * The rule is deliberately small and bounded:
 *  - at most one development per corporation and domain (the unique activeKey
 *    index backs this, so a replay or a race cannot add a second);
 *  - eligible only if cash left after the whole standard commitment stays above
 *    the NPP cash reserve (`getNppCashFloorAnchor`, the reserve behind #3561),
 *    and the company is not insolvent, in arrears or in financial distress;
 *  - one seeded roll per eligible company per turn. Per-turn start hazard
 *    p = 1 / (2 x 72) = 1/144, so that about one in three eligible companies
 *    has a product in development at steady state (derivation below);
 *  - the line is drawn with weights favouring outputs that are short in the
 *    market (the same price-ratio signal NPP founding uses, #3485);
 *  - tier: standard funding, lean when the cash left after the commitment is
 *    thin. Never all-in.
 *
 * Steady state. A company alternates idle and developing. Idle time before a
 * start is geometric with mean 1/p turns, development lasts D = 72 turns, so
 * the developing share is f = D / (D + 1/p) = Dp / (1 + Dp). Solving f = 1/3
 * gives Dp = 1/2, hence p = 1/144 ~ 0.69% per turn.
 *
 * Money moves through the same path as a player's venture: this module only
 * inserts the venture document. The per-turn guarded debit with its receipt,
 * the default resolution of decision events at their deadline, and the quality
 * roll are all `processProductVentures`.
 *
 * Cost: the rolls are pure; when at least one company rolls a start, exactly
 * one query reads the developing ventures' keys and one unordered insert
 * writes the new ones. No per-corporation database round trips.
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpLiquidCapitalToAnchor, fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import type { ManufacturingProductEligibilityOptions } from "../rules/manufacturingEligibility";
import { getManufacturingProductKind } from "../manufacturingCatalog";
import {
  VENTURE_DEVELOPMENT_TURNS,
  VENTURE_FUNDING_TIERS,
  newVenture,
  referenceFundingPerTurn,
  seededUnit,
  ventureTargetAnchor,
} from "./engine";
import { availableVentureLines, liftedSectorIds } from "./lines";
import { sectorTurnRevenueAnchor } from "./revenue";
import { PRODUCT_VENTURES, ventureDocument } from "./store";
import { ventureSector } from "./turn";
import type { ProductVenture, VentureDomain } from "./types";

/** Share of eligible NPP companies with a product in development at steady state. */
export const NPP_VENTURE_STEADY_SHARE = 1 / 3;
/** Per-turn start hazard for an idle, eligible company: f / (D x (1 - f)). */
export const NPP_VENTURE_START_HAZARD =
  NPP_VENTURE_STEADY_SHARE / (VENTURE_DEVELOPMENT_TURNS * (1 - NPP_VENTURE_STEADY_SHARE));
/** Same shape as NPP founding: a short output weighs as the square of its price ratio. */
export const NPP_VENTURE_SHORTAGE_EXPONENT = 2;
export const NPP_VENTURE_MIN_SHORTAGE_SCORE = 0.5;
/** Cash above reserve + commitment below this multiple of the reserve is "tight": go lean. */
export const NPP_VENTURE_TIGHT_HEADROOM_RESERVES = 1;

export type NppVentureTierId = "lean" | "standard";

const TIER_MULTIPLE = Object.fromEntries(
  VENTURE_FUNDING_TIERS.map((tier) => [tier.id, tier.multiple])
) as Record<string, number>;

export interface NppVentureStart {
  corporationId: string;
  domain: VentureDomain;
  lineId: string;
  name: string;
  tier: NppVentureTierId;
  baselineRevenueAnchor: number;
  fundingPerTurnAnchor: number;
}

export type CommodityRatioFn = (commodity: string, countryId: string) => number | null | undefined;

export interface NppVentureSelectionArgs {
  turn: number;
  corporations: readonly Corporation[];
  sectorsByCorp: ReadonlyMap<string, readonly CorporateSector[]>;
  exchangeRatesByCurrency: ReadonlyMap<CurrencyCode, number>;
  enabled: Record<VentureDomain, boolean>;
  /** NPP cash reserve in anchor currency (`getNppCashFloorAnchor`). */
  reserveAnchor: number;
  priceRatioOf: CommodityRatioFn;
  currentYear?: number;
  techTreesEnabled?: boolean;
  /** Per-turn start hazard. Tests override it; production uses the derived default. */
  hazard?: number;
}

export function isNppRun(corp: Corporation): boolean {
  return corp.ceoType === "npp" && !!corp.ceoId && corp.ownershipState !== "stateOwned";
}

function hasPositive(record: Record<string, number | undefined> | undefined): boolean {
  return !!record && Object.values(record).some((v) => typeof v === "number" && v > 0);
}

/** Insolvent, in financial distress, or behind on payroll-adjacent or tax obligations. */
export function isNppDistressed(corp: Corporation): boolean {
  return (
    (corp.liquidCapital ?? 0) < 0 ||
    corp.financialDistressSinceTurn !== undefined ||
    corp.nppInsolventSinceTurn !== undefined ||
    hasPositive(corp.operatingCashArrearsByCurrency) ||
    hasPositive(corp.operatingCashArrearsLastTurnByCurrency) ||
    hasPositive(corp.federalTaxArrearsAnchorByCountry) ||
    hasPositive(corp.federalTaxArrearsLastTurnByCountry)
  );
}

/** Weight of a line: media is neutral, a manufactured line follows how short its output is. */
export function nppLineWeight(
  domain: VentureDomain,
  lineId: string,
  countryId: string,
  priceRatioOf: CommodityRatioFn
): number {
  if (domain === "media") return 1;
  const kind = getManufacturingProductKind(lineId);
  if (!kind) return 1;
  const raw = priceRatioOf(kind.outputCommodity, countryId);
  const score = Math.max(
    NPP_VENTURE_MIN_SHORTAGE_SCORE,
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1
  );
  return Math.pow(score, NPP_VENTURE_SHORTAGE_EXPONENT);
}

function pickWeighted(weights: readonly number[], roll: number): number {
  const total = weights.reduce((sum, w) => sum + (w > 0 ? w : 0), 0);
  if (!(total > 0)) return Math.min(weights.length - 1, Math.floor(roll * weights.length));
  let target = roll * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    if (target < w) return i;
    target -= w;
  }
  return weights.length - 1;
}

export function nppVentureName(label: string, corporationId: string, turn: number): string {
  const series = 1 + Math.floor(seededUnit(`npp-venture-name:${corporationId}:${turn}`) * 9);
  return `${label} Series ${series}`.slice(0, 60);
}

/**
 * Pure selection. `busyKeys` holds `${corporationId}:${domain}` for ventures
 * already in development. Deterministic in (corporation id, turn).
 */
export function selectNppVentureStarts(
  args: NppVentureSelectionArgs,
  busyKeys: ReadonlySet<string> = new Set()
): NppVentureStart[] {
  const hazard = args.hazard ?? NPP_VENTURE_START_HAZARD;
  const eligibility: ManufacturingProductEligibilityOptions = {
    currentYear: args.currentYear,
    techTreesEnabled: args.techTreesEnabled === true,
  };
  const starts: NppVentureStart[] = [];
  for (const corp of args.corporations) {
    if (!isNppRun(corp) || isNppDistressed(corp)) continue;
    const corporationId = corp._id.toString();
    if (seededUnit(`npp-venture:${corporationId}:${args.turn}`) >= hazard) continue;
    const sectors = args.sectorsByCorp.get(corporationId) ?? [];
    if (sectors.length === 0) continue;
    const ventureSectors = sectors.map(ventureSector);

    const fx = fxRateForCorpFromMap(corp, args.exchangeRatesByCurrency);
    const liquidAnchor = corpLiquidCapitalToAnchor(Math.max(0, corp.liquidCapital ?? 0), corp, fx);

    interface Candidate {
      domain: VentureDomain;
      lineId: string;
      label: string;
      baseline: number;
      weight: number;
    }
    const candidates: Candidate[] = [];
    for (const domain of ["media", "manufacturing"] as const) {
      if (!args.enabled[domain] || busyKeys.has(`${corporationId}:${domain}`)) continue;
      const lines = availableVentureLines({
        domain,
        corporationId,
        sectors: ventureSectors,
        currentYear: args.currentYear,
        eligibility: {
          ...eligibility,
          unlockedTechNodeIds: corp.unlockedTechNodeIds,
          techDecadeLane: corp.techDecadeLane,
        },
      });
      for (const status of lines) {
        if (!status.available) continue;
        const lifted = new Set(
          liftedSectorIds({
            domain,
            lineId: status.line.id,
            corporationId,
            sectors: ventureSectors,
          })
        );
        if (lifted.size === 0) continue;
        const baseline = sectors
          .filter((sector) => lifted.has(sector._id.toString()))
          .reduce(
            (sum, sector) =>
              sum + sectorTurnRevenueAnchor(sector, corp, args.exchangeRatesByCurrency),
            0
          );
        const target = ventureTargetAnchor(baseline);
        // The full standard commitment must leave the reserve intact.
        if (liquidAnchor - target < args.reserveAnchor) continue;
        candidates.push({
          domain,
          lineId: status.line.id,
          label: status.line.label,
          baseline,
          weight: nppLineWeight(domain, status.line.id, corp.countryId ?? "", args.priceRatioOf),
        });
      }
    }
    if (candidates.length === 0) continue;

    const pick =
      candidates[
        pickWeighted(
          candidates.map((c) => c.weight),
          seededUnit(`npp-venture-line:${corporationId}:${args.turn}`)
        )
      ];
    const target = ventureTargetAnchor(pick.baseline);
    const headroom = liquidAnchor - target - args.reserveAnchor;
    const tier: NppVentureTierId =
      headroom < args.reserveAnchor * NPP_VENTURE_TIGHT_HEADROOM_RESERVES ? "lean" : "standard";
    starts.push({
      corporationId,
      domain: pick.domain,
      lineId: pick.lineId,
      name: nppVentureName(pick.label, corporationId, args.turn),
      tier,
      baselineRevenueAnchor: pick.baseline,
      fundingPerTurnAnchor: referenceFundingPerTurn(target) * TIER_MULTIPLE[tier],
    });
  }
  return starts;
}

/** Selects and inserts this turn's NPP ventures. Idempotent per turn. */
export async function startNppVentures(
  db: Db,
  args: NppVentureSelectionArgs
): Promise<NppVentureStart[]> {
  // Pure rolls first: most turns nobody rolls a start and no query is made.
  const probe = selectNppVentureStarts(args);
  if (probe.length === 0) return [];
  const busy = await db
    .collection<ProductVenture>(PRODUCT_VENTURES)
    .find({ stage: "development" }, { projection: { activeKey: 1 } })
    .toArray();
  const busyKeys = new Set(busy.flatMap((row) => (row.activeKey ? [row.activeKey] : [])));
  const starts = selectNppVentureStarts(args, busyKeys);
  if (starts.length === 0) return [];
  const docs = starts.map((start) => {
    const venture = newVenture({
      id: new ObjectId().toString(),
      corporationId: start.corporationId,
      domain: start.domain,
      lineId: start.lineId,
      name: start.name,
      turn: args.turn,
      baselineRevenueAnchor: start.baselineRevenueAnchor,
      fundingPerTurnAnchor: start.fundingPerTurnAnchor,
    });
    return { _id: venture._id, ...ventureDocument(venture) };
  });
  try {
    await db
      .collection<ProductVenture>(PRODUCT_VENTURES)
      .insertMany(docs as never, { ordered: false });
  } catch (error) {
    // A duplicate activeKey means that company already has one: not an error.
    const writeErrors = (error as { writeErrors?: Array<{ code?: number }> }).writeErrors;
    const onlyDuplicates =
      (error as { code?: number }).code === 11000 &&
      (!writeErrors || writeErrors.every((e) => e.code === 11000));
    if (!onlyDuplicates) throw error;
  }
  return starts;
}
