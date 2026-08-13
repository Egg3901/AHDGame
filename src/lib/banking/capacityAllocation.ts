import type { Db, ObjectId } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { defaultSupplyRates } from "@/lib/constants/capacityEconomy";
import { impliedOutputUnits } from "@/lib/market/capital";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getStrategy } from "@/lib/constants/sectorStrategies";

/**
 * Default share of financial-sector capacity allocated to the branch network
 * (vs commodity `financial_services` output) when the CEO has not set one.
 * Provisional - flagged for user review.
 */
export const DEFAULT_BRANCH_CAPACITY_SHARE = 0.5;

/**
 * Home-currency face deposits supported per unit of branch capacity.
 *
 * Derivation (modern unit scale = 1, financial `standard` strategy):
 *   k = supply_rate / basePrice = 0.5 / 2000 = 0.00025 units per ₳ of daily revenue
 *   A typical single financial sector at DEFAULT_SECTOR_STARTING_REVENUE (1M ₳/day)
 *     => capacity units = 1_000_000 × 0.00025 = 250
 *   Charter capital = 10 × CORPORATION_FOUNDING_COST = 10M
 *   Target deposits at 50% branch share ~ 10-20× charter = 100M-200M
 *     => DEPOSIT_CEILING_PER_CAPACITY_UNIT = target / (units × 0.5)
 *       in [800_000, 1_600_000]; midpoint 1_200_000 gives
 *       250 × 0.5 × 1_200_000 = 150M = 15× charter capital.
 *
 * Provisional - worldsim / playtest may retune.
 */
export const DEPOSIT_CEILING_PER_CAPACITY_UNIT = 1_200_000;

/** Inclusive CEO-set bounds for branchCapacityShare. */
export const MIN_BRANCH_CAPACITY_SHARE = 0.1;
export const MAX_BRANCH_CAPACITY_SHARE = 0.9;

export type SetBranchCapacityShareResult =
  { ok: true; branchCapacityShare: number } | { ok: false; error: string };

/**
 * Resolved branch-capacity share on a charter. Unset / non-finite -> default 0.5.
 * Does not clamp to the CEO slider band; callers that persist must validate.
 */
export function getBranchCapacityShare(
  charter: Pick<BankCharter, "branchCapacityShare"> | null | undefined
): number {
  const raw = charter?.branchCapacityShare;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return DEFAULT_BRANCH_CAPACITY_SHARE;
}

/**
 * Deposit ceiling from financial-sector capacity allocated to branches:
 *   ceiling = financialSectorCapacity × branchShare × DEPOSIT_CEILING_PER_CAPACITY_UNIT
 */
export function computeDepositCeiling(
  financialSectorCapacity: number,
  branchShare: number
): number {
  const capacity =
    typeof financialSectorCapacity === "number" && Number.isFinite(financialSectorCapacity)
      ? Math.max(0, financialSectorCapacity)
      : 0;
  const share =
    typeof branchShare === "number" && Number.isFinite(branchShare) ? Math.max(0, branchShare) : 0;
  return capacity * share * DEPOSIT_CEILING_PER_CAPACITY_UNIT;
}

/**
 * Capacity units for one financial sector: `capitalStock` when present and
 * positive (plants / capital mode authority), else implied output units from
 * the sector's revenue and effective supply mix (same map capacityEconomy /
 * sectorTurn use via {@link impliedOutputUnits}).
 */
export function financialSectorCapacityUnits(
  sector: Pick<CorporateSector, "capitalStock" | "revenue" | "strategyId" | "sectorType">,
  eraUnitScale: number
): number {
  const stock = sector.capitalStock;
  if (typeof stock === "number" && Number.isFinite(stock) && stock > 0) {
    return stock;
  }
  const revenue =
    typeof sector.revenue === "number" && Number.isFinite(sector.revenue)
      ? Math.max(0, sector.revenue)
      : 0;
  if (!(revenue > 0)) return 0;
  const strategy = getStrategy("financial", sector.strategyId ?? "standard");
  const supply = strategy?.supply ?? defaultSupplyRates("financial");
  return impliedOutputUnits(revenue, supply, COMMODITY_BASE_PRICES, eraUnitScale);
}

/**
 * Sum of the corp's financial-sector capacity × branch share × ceiling factor.
 * Returns 0 when the corp has no active charter.
 */
export async function getBankDepositCeiling(db: Db, corp: Corporation): Promise<number> {
  const charter = corp.bankCharter;
  if (!charter || charter.status !== "active") return 0;

  const [sectors, eraUnitScale] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: corp._id, sectorType: "financial" },
        { projection: { capitalStock: 1, revenue: 1, strategyId: 1, sectorType: 1 } }
      )
      .toArray(),
    loadWorldEraUnitScale(db),
  ]);

  const capacity = sectors.reduce(
    (sum, s) => sum + financialSectorCapacityUnits(s, eraUnitScale),
    0
  );
  return computeDepositCeiling(capacity, getBranchCapacityShare(charter));
}

/**
 * Commodity-side production scale for a financial sector: the share of capacity
 * NOT allocated to the branch network. 1 when banking is off or the corp is
 * unchartered (zero behaviour change).
 */
export function commodityProductionCapacityScale(
  charter: BankCharter | null | undefined,
  privateBankingEnabled: boolean
): number {
  if (!privateBankingEnabled || charter?.status !== "active") return 1;
  return Math.max(0, 1 - getBranchCapacityShare(charter));
}

/**
 * CEO sets branchCapacityShare in [0.1, 0.9]. Rejects out-of-band values
 * (does not silently clamp).
 */
export async function setBranchCapacityShare(
  db: Db,
  corporationId: ObjectId,
  branchCapacityShare: number
): Promise<SetBranchCapacityShareResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }
  if (
    !Number.isFinite(branchCapacityShare) ||
    branchCapacityShare < MIN_BRANCH_CAPACITY_SHARE ||
    branchCapacityShare > MAX_BRANCH_CAPACITY_SHARE
  ) {
    return {
      ok: false,
      error: `branchCapacityShare must be between ${MIN_BRANCH_CAPACITY_SHARE} and ${MAX_BRANCH_CAPACITY_SHARE}`,
    };
  }

  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp) return { ok: false, error: "Corporation not found" };
  if (corp.bankCharter?.status !== "active") {
    return { ok: false, error: "Corporation has no active bank charter" };
  }

  const updated = await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "active" },
    {
      $set: {
        "bankCharter.branchCapacityShare": branchCapacityShare,
        updatedAt: new Date(),
      },
    }
  );
  if (updated.matchedCount !== 1) {
    return { ok: false, error: "Failed to update branch capacity share" };
  }

  return { ok: true, branchCapacityShare };
}
