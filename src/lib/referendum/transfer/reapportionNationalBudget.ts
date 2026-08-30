/**
 * Move a transferring region's share of the source country's NATIONAL fiscal
 * load to the target. The federal budget doc itself is country-level and stays
 * put (it is NOT rescoped); only its economy-sized magnitudes reapportion:
 *
 *   - `taxBases` (income, corporate, wages, imports, sales) — top-level figures
 *     grown per turn, never re-summed from regions, so they must shed/absorb the
 *     region's share explicitly. Federal revenue recomputes off them next turn.
 *   - spending baselines (`baselineStateGrants`, `baselineSpendingByCategory`) —
 *     stored baselines the spending engine reads; the source no longer funds the
 *     region's services, the target now does.
 *
 * Deliberately LEFT ALONE:
 *   - `gdp` — re-derived from Σ `state.gdp` at fiscal close, and the region's
 *     `state.gdp` already followed via the rescope, so it self-corrects.
 *   - `debt` / `treasuryBalance` — accumulated balances that belong to the
 *     country that ran them up, not a per-region share.
 *
 * Weight = the region's GDP share of the source country (its economic bases scale
 * with output, so GDP share is a truer split than population).
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, State } from "@/lib/db/types";

type NumMap = Record<string, number>;

/** Split a numeric map: move `weight` of each `from` entry into `to`. */
function shiftNumericMap(
  from: NumMap | undefined,
  to: NumMap | undefined,
  weight: number
): { from: NumMap; to: NumMap } {
  const f: NumMap = { ...(from ?? {}) };
  const t: NumMap = { ...(to ?? {}) };
  for (const [k, v] of Object.entries(f)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const amt = v * weight;
    f[k] = v - amt;
    t[k] = (typeof t[k] === "number" ? t[k] : 0) + amt;
  }
  return { from: f, to: t };
}

export async function reapportionNationalBudget(
  db: Db,
  regionId: string,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<void> {
  const region = await db
    .collection<State>("states")
    .findOne({ _id: regionId }, { projection: { gdp: 1 } });
  const regionGdp = region?.gdp ?? 0;
  if (regionGdp <= 0) return;

  // Source country's pre-transfer GDP = its remaining regions + this one (the
  // region's `countryId` has already flipped to the target by this point).
  const remaining = await db
    .collection<State>("states")
    .find({ countryId: fromCountryId })
    .project<{ gdp?: number }>({ gdp: 1 })
    .toArray();
  const sourceTotalBefore = remaining.reduce((s, r) => s + (r.gdp ?? 0), 0) + regionGdp;
  const weight = sourceTotalBefore > 0 ? regionGdp / sourceTotalBefore : 0;
  // Weight 1 is REAL: the last region of a dissolving country has nothing left
  // behind it, and skipping it would strand the whole residual base (tax bases,
  // spending baselines, grants) on a country that no longer exists. Only a
  // degenerate non-positive weight bails.
  if (!(weight > 0 && weight <= 1)) return;

  const [from, to] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: fromCountryId }),
    db.collection<FederalBudget>("federalBudget").findOne({ _id: toCountryId }),
  ]);
  if (!from || !to) return;
  const now = new Date();

  type TaxBases = FederalBudget["taxBases"];
  const taxB = shiftNumericMap(
    from.taxBases as unknown as NumMap,
    to.taxBases as unknown as NumMap,
    weight
  );
  const taxFrom = taxB.from as unknown as TaxBases;
  const taxTo = taxB.to as unknown as TaxBases;
  const spend = shiftNumericMap(
    from.baselineSpendingByCategory,
    to.baselineSpendingByCategory,
    weight
  );
  const grant = (from.baselineStateGrants ?? 0) * weight;

  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: fromCountryId },
    {
      $set: {
        taxBases: taxFrom,
        baselineSpendingByCategory: spend.from,
        baselineStateGrants: (from.baselineStateGrants ?? 0) - grant,
        updatedAt: now,
      },
    }
  );
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: toCountryId },
    {
      $set: {
        taxBases: taxTo,
        baselineSpendingByCategory: spend.to,
        baselineStateGrants: (to.baselineStateGrants ?? 0) + grant,
        updatedAt: now,
      },
    }
  );
}
