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
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import type { EnactedLaw, FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { resolveMergeFxScale } from "./mergeFxScale";

export interface MergeNationalFiscArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
  currentTurn: number;
  /**
   * Whether the absorbed side's LEGISLATED levers govern the unified state.
   *
   * Defaults true, which is the winner's-law rule: a merge runs winner-into-shell,
   * so the absorbed side is the one that won and its tax code, wage floor and union
   * law outlive the state that wrote them.
   *
   * ⚠️ FALSE WHEN THE SHELL IS THE WINNER. A settlement can be run in either
   * direction — the German Question can leave either Germany standing — and when
   * the SURVIVOR is the victor, carrying the absorbed side's levers would impose
   * the LOSER's law on the winner, which is the rule stood on its head.
   *
   * QUANTITIES ARE NOT LEVERS and cross either way: the treasury, the defence
   * account, the sovereign bonds and the debt CEILING are how much the unified
   * state holds and may borrow, not rules about how it behaves. A state that has
   * absorbed another has not thereby lost the money or the borrowing capacity of
   * the half it took on.
   */
  carryLegislatedLevers?: boolean;
  /**
   * The two countries' fiscal bases (Σ state.gdp, Σ state.population) captured
   * BEFORE the region transfers moved, plus each side's live income-band index.
   *
   * Fraction-priced laws price their terms against the LIVE fiscal base of the
   * country they are keyed to. The merge does not change what either state's
   * programmes ARE — a 5.93%-of-GDP army is 4x more expensive the moment the
   * same fraction applies to the merged economy — so without a re-base the
   * unified treasury inherits a law book sized for one economy and prices it
   * against a base several times larger, while the revenue side stays under
   * its Laffer cap. Both books together then price to ~87% of merged GDP
   * against a ~52-58% revenue ceiling: a permanent structural deficit no
   * player decision can close (the live German reunification landed at
   * -103bn/yr from +29bn combined surplus for exactly this reason).
   *
   * With the bases present, every national law keeps the ABSOLUTE annual cost
   * it priced at in its own country — gdp-fraction and income-fraction terms
   * (v2 and legacy) and GDP-multiplier terms are rescaled onto the merged base
   * at merge time. Thereafter each law still tracks the unified economy as any
   * fraction does. Optional only for backwards compatibility: callers that
   * capture nothing get the old behaviour.
   */
  mergeBases?: MergeFiscalBases;
}

export interface MergeFiscalBases {
  fromGdp: number;
  fromPopulation: number;
  fromIncomeBand: number;
  toGdp: number;
  toPopulation: number;
  toIncomeBand: number;
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
  const {
    fromCountryId,
    toCountryId,
    currentTurn,
    carryLegislatedLevers = true,
    mergeBases,
  } = args;
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
    if (carryLegislatedLevers) {
      if (from.taxRates) lawSet.taxRates = from.taxRates;
      if (from.taxRatePhaseIn) lawSet.taxRatePhaseIn = from.taxRatePhaseIn;
    }
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
    //
    // ⚠️ A SURVIVOR THAT WAS ITSELF ABSORBED CONTRIBUTES NOTHING. `mergedInto` on
    // the survivor's own budget says its figures are the remnants of a state that
    // was already merged away, and its ceiling has therefore ALREADY been counted
    // into the absorbed side's. Adding it again double-counts: reversing a merge
    // would hand the unified state its own former ceiling a second time. The
    // remnant is superseded, not additive.
    const survivorCeiling = to.mergedInto ? 0 : (to.debt?.ceiling ?? 0);
    const fromCeiling = from.debt?.ceiling;
    if (typeof fromCeiling === "number") {
      lawSet["debt.ceiling"] = survivorCeiling + fromCeiling * scale;
      const raisedYears = [from.debt?.ceilingLastRaisedYear, to.debt?.ceilingLastRaisedYear].filter(
        (year): year is number => typeof year === "number"
      );
      if (raisedYears.length > 0) {
        lawSet["debt.ceilingLastRaisedYear"] = Math.max(...raisedYears);
      }
    }
    if (carryLegislatedLevers) {
      if (typeof from.minimumWageKaitzRatio === "number") {
        lawSet.minimumWageKaitzRatio = from.minimumWageKaitzRatio;
      }
      if (typeof from.unionLawBias === "number") lawSet.unionLawBias = from.unionLawBias;
      if (typeof from.unionsBanned === "boolean") lawSet.unionsBanned = from.unionsBanned;
    }

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
  // "national", no stateId) is what nothing else moves. Money fields convert
  // (currency only) and the fraction terms re-base onto the merged economy
  // below, because their pricing base is changed BY the merge.
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

  // ── Fraction-term re-base ──────────────────────────────────────────────────
  // Fraction-priced terms (v2 costModelV2 and the legacy fraction/multiplier
  // fields) price against the LIVE fiscal base of the country keying the law.
  // The merge re-keys the absorbed book and GROWS the survivor's base, so left
  // alone every one of these laws silently reprices onto the merged economy:
  // the GDR's 45%-of-GDP law book alone went from 45bn to 168bn the day it
  // absorbed a country four times its size, and the two books together priced
  // to ~87% of merged GDP against a ~52-58% Laffer-capped revenue ceiling — a
  // structural deficit no player decision could close. The live German
  // reunification swung from +29bn combined surplus to -103bn/yr on this alone.
  //
  // The rule the rest of this module already obeys: QUANTITIES CROSS. Each law
  // keeps the ABSOLUTE annual cost it priced at in its own country, re-expressed
  // in the survivor frame; after the merge every fraction still tracks the
  // unified economy from that anchor.
  //
  // Ownership decides each law's pre-merge base: a law read from the absorbed
  // book priced against `fromGdp`/`fromPopulation`; a law the SHELL already
  // held priced against `toGdp`/`toPopulation`. Both sides get the same
  // treatment — the unified treasury inherits both states' obligations at their
  // authored sizes, not the absorbed book resized and the shell's book inflated.
  //
  // Idempotency: every re-based law is stamped, and the stamp filter skips
  // stamped rows, so a re-entered merge (or a re-run after a prior attempt's
  // rescope landed) cannot apply the ratio twice.
  const rebaseOps: Array<{
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }> = [];
  if (mergeBases && from && to && !from.mergedInto) {
    // The merged base is the LIVE rollup over the states as they now stand
    // (both sides' regions plus any fused region). The two pre-merge bases are
    // what the caller captured BEFORE the region transfers moved; reading them
    // here would find every region already re-keyed and a zero absorbed side.
    const merged = await countryFiscalBase(db, toCountryId);
    if (merged.gdp > 0 && merged.population > 0) {
      // The v2 income term is `incomeCostFraction × incomeAnchor × band ×
      // population`. The anchor is per-law-prefix and does not move; the band
      // is the pricing country's live band, which for the survivor may differ
      // from the band each side priced at before the merge. Both the population
      // and the band change fold into the term's factor.
      const gs = await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" as const }, { projection: { incomeBandIndexByCountry: 1 } });
      const liveBandTo = gs?.incomeBandIndexByCountry?.[toCountryId] ?? mergeBases.toIncomeBand;

      const stamp = { from: fromCountryId, to: toCountryId, turn: currentTurn };
      const pushRebase = (
        law: EnactedLaw,
        own: { gdp: number; population: number; band: number }
      ): void => {
        const set: Record<string, unknown> = {};
        const gdpFactor = own.gdp / merged.gdp;
        const popBandFactor = (own.population * own.band) / (merged.population * liveBandTo);
        const v2 = law.costModelV2;
        if (v2) {
          if (typeof v2.gdpCostFraction === "number" && Number.isFinite(v2.gdpCostFraction)) {
            set["costModelV2.gdpCostFraction"] = v2.gdpCostFraction * gdpFactor;
          }
          if (typeof v2.gdpRevenueFraction === "number" && Number.isFinite(v2.gdpRevenueFraction)) {
            set["costModelV2.gdpRevenueFraction"] = v2.gdpRevenueFraction * gdpFactor;
          }
          if (typeof v2.incomeCostFraction === "number" && Number.isFinite(v2.incomeCostFraction)) {
            set["costModelV2.incomeCostFraction"] = v2.incomeCostFraction * popBandFactor;
          }
        }
        // Legacy Spec-B fraction fields price on the budget GDP (`frac × gdp`;
        // the income class via `frac × incomeToGdp × gdp`): the same GDP ratio.
        if (typeof law.gdpCostFraction === "number" && Number.isFinite(law.gdpCostFraction)) {
          set.gdpCostFraction = law.gdpCostFraction * gdpFactor;
        }
        if (typeof law.incomeCostFraction === "number" && Number.isFinite(law.incomeCostFraction)) {
          set.incomeCostFraction = law.incomeCostFraction * gdpFactor;
        }
        // `gdpPerCapitaMultiplier × budget.gdp` — the budget gdp converges on
        // the merged rollup at the next fiscal close, so the same factor keeps
        // the absolute cost in place.
        if (
          typeof law.gdpPerCapitaMultiplier === "number" &&
          Number.isFinite(law.gdpPerCapitaMultiplier)
        ) {
          set.gdpPerCapitaMultiplier = law.gdpPerCapitaMultiplier * gdpFactor;
        }
        if (Object.keys(set).length > 0) {
          rebaseOps.push({
            updateOne: {
              filter: { _id: law._id },
              update: { $set: { ...set, mergeRebased: stamp, updatedAt: now } },
            },
          });
        }
      };

      // The carried book: these are the rows this call is re-scoping, priced in
      // the absorbed country before it moved.
      for (const law of nationalLaws) {
        pushRebase(law, {
          gdp: mergeBases.fromGdp,
          population: mergeBases.fromPopulation,
          band: mergeBases.fromIncomeBand,
        });
      }
      // The shell's own book: everything national keyed to the survivor that is
      // not one of the carried rows and not already re-based. The `mergedInto`
      // gate above means only the first merge run gets here; the stamp covers
      // the re-entered attempt that arrives after a crash mid-write.
      const shellLaws = await laws
        .find({
          countryId: toCountryId,
          $or: [{ stateId: { $exists: false } }, { stateId: null }],
          _id: { $nin: nationalLaws.map((law) => law._id) },
          mergeRebased: { $exists: false },
        } as import("mongodb").Filter<EnactedLaw>)
        .toArray();
      for (const law of shellLaws) {
        pushRebase(law, {
          gdp: mergeBases.toGdp,
          population: mergeBases.toPopulation,
          band: mergeBases.toIncomeBand,
        });
      }
    }
  }

  // Scale 1 with no re-base needs no per-doc math and collapses to one
  // updateMany. Otherwise one bulkWrite carries each law's rescope, converted
  // money fields and re-based fraction terms TOGETHER, so a crash between them
  // cannot leave a law re-keyed but un-rebased (or re-keyed twice): the write
  // is the unit of recovery.
  const rebaseByCarried = new Map(
    rebaseOps.map((op) => [String(op.updateOne.filter._id), op.updateOne.update.$set])
  );
  if (nationalLaws.length > 0 && scale === 1 && rebaseOps.length === 0) {
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
        const rebaseSet = rebaseByCarried.get(String(law._id));
        return {
          updateOne: {
            filter: { _id: law._id },
            update: {
              $set: {
                countryId: toCountryId,
                ...moneySet,
                ...(rebaseSet ?? {}),
              },
            },
          },
        };
      })
    );
  }

  // The shell's own book re-bases in its own write: these rows are not being
  // re-scoped (they already key to the survivor), and the stamp filter in the
  // query above is what keeps a re-run from applying the ratio twice.
  const carriedIdSet = new Set(nationalLaws.map((law) => String(law._id)));
  const shellOnlyOps = rebaseOps.filter((op) => !carriedIdSet.has(String(op.updateOne.filter._id)));
  if (shellOnlyOps.length > 0) {
    await laws.bulkWrite(shellOnlyOps);
  }

  return {
    fxScale: scale,
    treasuryMoved,
    bondsRescoped: absorbedBonds.length,
    lawsRescoped: nationalLaws.length,
  };
}
