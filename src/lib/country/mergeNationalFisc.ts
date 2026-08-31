/**
 * The absorbed country's national balance sheet moves to the survivor.
 *
 * A dissolving country's regions carry their own budgets, laws and money across
 * with `transferRegion` — but the NATIONAL layer has no region to ride: the
 * treasury (signed; its debt is the mirror), the defence account, the sovereign
 * bonds real players hold, and the national law book. Left behind, the treasury
 * pays coupons from a ghost ledger until it defaults for a country that no
 * longer exists, and the survivor's budget forgets every national programme the
 * absorbed state ever legislated. This module is the assumption of state debts
 * and obligations that every real unification includes.
 *
 * CURRENCY. Everything crosses at ONE scale (`resolveMergeFxScale`). Bonds
 * convert by scaling UNITS, not the per-unit face: `BOND_UNIT_FACE_VALUE` is a
 * global constant ("one unit = 1,000 of the bond's currencyCode"), so the only
 * value-preserving conversion is units × scale with the currency re-stamped.
 * `avgCostPerUnit` is invariant under that transform (total cost and unit count
 * scale together), which is why it is left untouched. Units may become
 * fractional; every consumer multiplies rather than counts, so that is a
 * display quirk, not a correctness problem.
 *
 * IDEMPOTENT by filters: a re-run finds no bonds/laws still keyed to the
 * absorbed country and a zeroed absorbed treasury, so every write degrades to a
 * no-op. The `mergedInto` stamp on the absorbed budget is the audit trail, not
 * the guard.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import type { EnactedLaw, FederalBudget } from "@/lib/db/types/budget";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { resolveMergeFxScale } from "./mergeFxScale";

export interface MergeNationalFiscArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
  currentTurn: number;
}

export interface MergeNationalFiscResult {
  fxScale: number;
  /** Signed amount (survivor-local) added to the survivor's treasury. */
  treasuryMoved: number;
  bondsRescoped: number;
  lawsRescoped: number;
}

/** EnactedLaw money fields (local currency). Ratio/fraction fields must NOT convert. */
const LAW_MONEY_FIELDS = ["annualCostUsd", "annualCostPerCapita", "annualRevenueV2"] as const;

export async function mergeNationalFisc(
  db: Db,
  args: MergeNationalFiscArgs
): Promise<MergeNationalFiscResult> {
  const { fromCountryId, toCountryId, currentTurn } = args;
  const now = new Date();
  const scale = await resolveMergeFxScale(db, fromCountryId, toCountryId);
  const budgets = db.collection<FederalBudget>("federalBudget");

  // ── Treasury + defence account ─────────────────────────────────────────────
  const from = await budgets.findOne({ _id: fromCountryId });
  const to = await budgets.findOne({ _id: toCountryId });
  let treasuryMoved = 0;

  if (from && to) {
    const fromTreasury = from.treasuryBalance ?? 0;
    const fromDefence = from.defenseAppropriation?.balance ?? 0;
    treasuryMoved = fromTreasury * scale;

    if (fromTreasury !== 0 || fromDefence !== 0) {
      // The survivor's book: signed add, debt mirror recomputed from the new
      // balance (treasuryBalance is the source of truth; debt.principal is
      // derived = max(0, -balance)).
      const newToTreasury = (to.treasuryBalance ?? 0) + fromTreasury * scale;
      await budgets.updateOne(
        { _id: toCountryId },
        {
          $set: {
            treasuryBalance: newToTreasury,
            "debt.principal": Math.max(0, -newToTreasury),
            updatedAt: now,
          },
          ...(fromDefence !== 0
            ? { $inc: { "defenseAppropriation.balance": fromDefence * scale } }
            : {}),
        }
      );
      // The absorbed book: zeroed, stamped. NOT deleted — history and the wiki
      // still read it, and the fiscal loop stops visiting it via the dissolved
      // guard rather than via absence.
      await budgets.updateOne(
        { _id: fromCountryId },
        {
          $set: {
            treasuryBalance: 0,
            "debt.principal": 0,
            ...(from.defenseAppropriation ? { "defenseAppropriation.balance": 0 } : {}),
            mergedInto: { countryId: toCountryId, turn: currentTurn },
            updatedAt: now,
          },
        }
      );
    }
  }

  // ── Sovereign bonds ────────────────────────────────────────────────────────
  const toCurrency = COUNTRY_CURRENCY_MAP[toCountryId];
  const bonds = db.collection<Bond>("bonds");
  const absorbedBonds = await bonds
    .find({ issuerType: "sovereign", countryId: fromCountryId, matured: false })
    .toArray();

  for (const bond of absorbedBonds) {
    const holders = (bond.holders ?? []).map((h) => ({
      ...h,
      units: h.units * scale,
    }));
    await bonds.updateOne(
      { _id: bond._id },
      {
        $set: {
          countryId: toCountryId,
          totalIssued: (bond.totalIssued ?? 0) * scale,
          publicFloat: (bond.publicFloat ?? 0) * scale,
          ...(bond.centralBankHoldings != null
            ? { centralBankHoldings: bond.centralBankHoldings * scale }
            : {}),
          ...(bond.originalTotalIssued != null
            ? { originalTotalIssued: bond.originalTotalIssued * scale }
            : {}),
          holders,
          ...(toCurrency ? { currencyCode: toCurrency } : {}),
          updatedAt: now,
        },
      }
    );
  }

  // ── National enacted laws ──────────────────────────────────────────────────
  // Region law books rode their regions across; the NATIONAL book (scope
  // "national", no stateId) is what nothing else moves. Money fields convert;
  // fractions (gdpCostFraction, budgetCost's legacy percentage, multipliers)
  // are scale-free and stay.
  const laws = db.collection<EnactedLaw>("enactedLaws");
  // `stateId: null` matches both an absent field and an explicit null in Mongo;
  // the cast is because `EnactedLaw.stateId` is `string | undefined` and the
  // driver's Filter type refuses a literal null for it.
  const nationalLaws = await laws
    .find({
      countryId: fromCountryId,
      $or: [{ stateId: { $exists: false } }, { stateId: null }],
    } as import("mongodb").Filter<EnactedLaw>)
    .toArray();

  for (const law of nationalLaws) {
    const moneySet: Record<string, number> = {};
    if (scale !== 1) {
      for (const field of LAW_MONEY_FIELDS) {
        const value = law[field];
        if (typeof value === "number" && Number.isFinite(value)) {
          moneySet[field] = value * scale;
        }
      }
    }
    await laws.updateOne({ _id: law._id }, { $set: { countryId: toCountryId, ...moneySet } });
  }

  return {
    fxScale: scale,
    treasuryMoved,
    bondsRescoped: absorbedBonds.length,
    lawsRescoped: nationalLaws.length,
  };
}
