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
import { nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";
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

  // The `mergedInto` stamp is the idempotency guard for this whole block: a
  // re-run after completion must not re-add a zero treasury, and must not
  // re-carry levers over anything the unified government has since legislated.
  if (from && to && !from.mergedInto) {
    const fromTreasury = from.treasuryBalance ?? 0;
    const fromDefence = from.defenseAppropriation?.balance ?? 0;
    treasuryMoved = fromTreasury * scale;

    // THE WINNER'S FISCAL LAW TAKES OVER. Where both states carry a legislated
    // version of the same lever, the absorbed (winning) side's governs the
    // unified state — the merge direction runs winner-into-shell, so keeping
    // the shell's levers would let the LOSER's tax code outlive its state.
    // Rates and ratios are scale-free; the debt ceiling is money and converts.
    // Levers the absorbed side never legislated are left alone rather than
    // unset — absence is not a law. Deliberately NOT carried: `creditRating`,
    // `sovereignRiskAnchor` and `debt.interestRate`, which are the market's
    // assessment of the issuer, not legislation, and the fiscal machinery
    // recomputes them from the combined balance sheet.
    const lawSet: Record<string, unknown> = {};
    if (from.taxRates) lawSet.taxRates = from.taxRates;
    if (from.taxRatePhaseIn) lawSet.taxRatePhaseIn = from.taxRatePhaseIn;
    // THE DEBT CEILING IS THE ONE LEVER THAT SUMS RATHER THAN REPLACING.
    //
    // Every other carried lever is a RULE — a rate, a ratio, a prohibition — and
    // one state can only have one of each, so the winner's replaces the
    // survivor's. A ceiling is a QUANTITY: it is how much this state may borrow,
    // and a state that has just doubled in size has not thereby lost the
    // borrowing capacity of the half it absorbed.
    //
    // Replacing it was actively wrong. Germany's 18bn EUR ceiling would have
    // been overwritten by the GDR's 10bn DDM (~12.3bn EUR) — a 32% cut for a
    // state with three times the GDP, arrived at by treating a balance-sheet
    // capacity as though it were a tax rate. Summing keeps the arithmetic in the
    // same place as the treasury and the bond book, which already add.
    //
    // `ceilingLastRaisedYear` takes the LATER of the two: the combined ceiling is
    // new, and dating it to the older of the two raises would make the unified
    // state look overdue for a raise it just effectively had.
    const fromCeiling = from.debt?.ceiling;
    if (typeof fromCeiling === "number") {
      lawSet["debt.ceiling"] = (to.debt?.ceiling ?? 0) + fromCeiling * scale;
      const raisedYears = [from.debt?.ceilingLastRaisedYear, to.debt?.ceilingLastRaisedYear].filter(
        (year): year is number => typeof year === "number"
      );
      if (raisedYears.length > 0) {
        lawSet["debt.ceilingLastRaisedYear"] = Math.max(...raisedYears);
      }
    }
    if (typeof from.minimumWageKaitzRatio === "number") {
      lawSet.minimumWageKaitzRatio = from.minimumWageKaitzRatio;
    }
    if (typeof from.unionLawBias === "number") lawSet.unionLawBias = from.unionLawBias;
    if (typeof from.unionsBanned === "boolean") lawSet.unionsBanned = from.unionsBanned;

    // The survivor's book: signed add of the SAME number the caller records in
    // its audit trail (`treasuryMoved` — one expression, so the recorded amount
    // is by construction the credited amount), with the debt mirror recomputed
    // through the canonical derivation (`nationalDebtFromBalance`), never a
    // local copy of it.
    const newToTreasury = (to.treasuryBalance ?? 0) + treasuryMoved;
    await budgets.updateOne(
      { _id: toCountryId },
      {
        $set: {
          treasuryBalance: newToTreasury,
          "debt.principal": nationalDebtFromBalance(newToTreasury),
          ...lawSet,
          updatedAt: now,
        },
        ...(fromDefence !== 0
          ? { $inc: { "defenseAppropriation.balance": fromDefence * scale } }
          : {}),
      }
    );
    // The absorbed book: zeroed, stamped. NOT deleted — history and the wiki
    // still read it (its levers stay in place as the record of the law that
    // crossed), and the fiscal loop stops visiting it via the dissolved guard
    // rather than via absence.
    await budgets.updateOne(
      { _id: fromCountryId },
      {
        $set: {
          treasuryBalance: 0,
          "debt.principal": nationalDebtFromBalance(0),
          ...(from.defenseAppropriation ? { "defenseAppropriation.balance": 0 } : {}),
          mergedInto: { countryId: toCountryId, turn: currentTurn },
          updatedAt: now,
        },
      }
    );
  }

  // ── Sovereign bonds ────────────────────────────────────────────────────────
  const toCurrency = COUNTRY_CURRENCY_MAP[toCountryId];
  const bonds = db.collection<Bond>("bonds");
  const absorbedBonds = await bonds
    .find({ issuerType: "sovereign", countryId: fromCountryId, matured: false })
    .toArray();

  // One bulkWrite, not a per-doc await loop: the whole series re-scopes inside
  // a single turn phase.
  if (absorbedBonds.length > 0) {
    await bonds.bulkWrite(
      absorbedBonds.map((bond) => ({
        updateOne: {
          filter: { _id: bond._id },
          update: {
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
              holders: (bond.holders ?? []).map((h) => ({ ...h, units: h.units * scale })),
              ...(toCurrency ? { currencyCode: toCurrency } : {}),
              updatedAt: now,
            },
          },
        },
      }))
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

  // Scale 1 needs no per-doc math and collapses to one updateMany; otherwise
  // one bulkWrite carries every law's converted money fields in a round trip.
  if (nationalLaws.length > 0 && scale === 1) {
    await laws.updateMany(
      { _id: { $in: nationalLaws.map((law) => law._id) } },
      { $set: { countryId: toCountryId } }
    );
  } else if (nationalLaws.length > 0) {
    await laws.bulkWrite(
      nationalLaws.map((law) => {
        const moneySet: Record<string, number> = {};
        for (const field of LAW_MONEY_FIELDS) {
          const value = law[field];
          if (typeof value === "number" && Number.isFinite(value)) {
            moneySet[field] = value * scale;
          }
        }
        return {
          updateOne: {
            filter: { _id: law._id },
            update: { $set: { countryId: toCountryId, ...moneySet } },
          },
        };
      })
    );
  }

  return {
    fxScale: scale,
    treasuryMoved,
    bondsRescoped: absorbedBonds.length,
    lawsRescoped: nationalLaws.length,
  };
}
