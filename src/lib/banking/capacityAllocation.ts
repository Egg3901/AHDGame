import type { Db, ObjectId } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { defaultSupplyRates } from "@/lib/constants/capacityEconomy";
import { impliedOutputUnits } from "@/lib/market/capital";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { isDepositTakingCharter } from "@/lib/banking/charterKinds";
import { charterMay } from "@/lib/banking/rules/capabilities";

export {
  DEFAULT_BRANCH_CAPACITY_SHARE,
  DEPOSIT_CEILING_PER_CAPACITY_UNIT,
  MIN_BRANCH_CAPACITY_SHARE,
  MAX_BRANCH_CAPACITY_SHARE,
  getBranchCapacityShare,
  computeDepositCeiling,
} from "@/lib/banking/rules/capacity";
import {
  MIN_BRANCH_CAPACITY_SHARE,
  MAX_BRANCH_CAPACITY_SHARE,
  getBranchCapacityShare,
  computeDepositCeiling,
} from "@/lib/banking/rules/capacity";

export type SetBranchCapacityShareResult =
  { ok: true; branchCapacityShare: number } | { ok: false; error: string };

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
  if (!isDepositTakingCharter(charter)) return 0;

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
  // Only a DEPOSIT-TAKING charter runs a branch network, so only it pays for
  // one. This used to apply to every active charter with no type check, which
  // meant an investment bank surrendered up to half its financial sector's
  // commodity output to branches that are legally barred from taking a deposit.
  // It was a pure loss with no corresponding business, and the single cheapest
  // thing making the charter unviable.
  if (!charterMay(charter, "branchNetwork")) return 1;
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
