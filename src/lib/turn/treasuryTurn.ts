import {
  treasuryAccrualWithBankCouponReserve,
  treasuryAnchorValuation,
} from "@/lib/budget/rules/treasuryAccrual";
import { publishTreasuryAccrualReceipt } from "@/lib/budget/treasuryAccrualReceipt";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { expireFinancialCrisisAusterity } from "@/lib/crises/financialCrisisBudgetPolicy";
import { advanceTaxRatePhaseIn } from "@/lib/budget/taxRatePhaseIn";
import { getDb } from "@/lib/mongodb";
import type { FederalBudget, TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { sovereignDebtTerms } from "@/lib/bonds/sovereignPrincipal";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getRegisteredCountryIdSet } from "@/lib/country/registeredCountries";
import { enforcementTreasuryCostPerTurn } from "@/lib/unions/enforcementCosts";
import { settleBankSovereignClaims } from "@/lib/banking/bankSovereignClaims";
import { bankCouponClaim, bankCouponPlanForCountry } from "@/lib/banking/rules/sovereignClaims";
import { settleFundedSovereignCoupons } from "@/lib/banking/fundedSovereignCoupons";
import { isForexEnabled } from "@/lib/currency/featureFlag";

/**
 * Per-turn fiscal accrual (spec §4). For each country's federalBudget, move a
 * 1/TURNS_PER_YEAR slice of the current primary balance (revenue minus spending
 * excluding debt interest) into the signed treasuryBalance, then deduct live
 * debt-service on the bond-owned principal stock. This phase owns treasury cash
 * only: `debt.principal` belongs to the bond ledger (see
 * bonds/sovereignPrincipal.ts) and is never re-derived from the balance here
 * (#1975). Replaces the annual deficit jump that
 * processFiscalYear/processAnnualDebt used to apply.
 */
export async function processTreasuryTurn(_turn: number): Promise<{ countriesProcessed: number }> {
  const db = await getDb();

  // Self-heal: a country with a live central bank but no federalBudget doc
  // (e.g. a world bootstrapped via a partial seed path) would otherwise never
  // appear in the query below and would silently never accrue fiscal history.
  const [banks, gameStateDoc] = await Promise.all([
    db
      .collection<CentralBank>("centralBanks")
      .find({}, { projection: { countryId: 1 } })
      .toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
  // Shared banks (ECB) cover multiple member countries; heal every member's
  // budget, not just the anchor recorded on the bank doc. Banks and members
  // are independent, so the whole self-heal fans out.
  await Promise.all(
    banks.map(async (bank) => {
      const { memberCountries } = await getCentralBankScope(db, bank.countryId as CountryId);
      await Promise.all(
        memberCountries.map((countryId) => ensureFederalBudget(db, countryId, preset))
      );
    })
  );

  const allBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  // Dissolved countries keep their budget doc but must not be simulated against
  // it; see `getRegisteredCountryIdSet`.
  const liveCountries = await getRegisteredCountryIdSet(db);
  const budgets = allBudgets.filter(
    (b) =>
      liveCountries.has(String(b.countryId ?? b._id)) || (b.sovereignCouponClaims?.length ?? 0) > 0
  );

  const [config, rates] = await Promise.all([
    db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          ledgerShadow: 1,
          bankTreasuryEnabled: 1,
          treasuryCashLedgerEnabled: 1,
        },
      }
    ),
    db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
  ]);
  const rateByCurrency = new Map(rates.map((r) => [r.currencyCode, r.rate]));
  const ledgerShadow = config?.ledgerShadow === true;
  const bankTreasuryEnabled = config?.bankTreasuryEnabled === true;
  const treasuryCashLedgerEnabled = config?.treasuryCashLedgerEnabled === true;
  const sovereignBonds =
    bankTreasuryEnabled || treasuryCashLedgerEnabled
      ? await db
          .collection<Bond>("bonds")
          .find(
            { issuerType: "sovereign", defaulted: { $ne: true }, matured: { $ne: true } },
            {
              projection: {
                _id: 1,
                issuerType: 1,
                countryId: 1,
                currencyCode: 1,
                couponRate: 1,
                holders: 1,
                publicFloat: 1,
                matured: 1,
                defaulted: 1,
              },
            }
          )
          .toArray()
      : [];
  function valuationFor(
    budget: FederalBudget
  ): Pick<TreasuryAccrualReceipt, "anchorRate" | "anchorRateSource" | "anchorRatePreset"> {
    const currencyCode = resolveCountryCurrencyCode(budget) ?? "USD";
    try {
      return treasuryAnchorValuation({
        countryId: String(budget.countryId ?? budget._id),
        currencyCode,
        preset,
        observedRate: rateByCurrency.get(currencyCode),
      });
    } catch (error) {
      if (ledgerShadow) throw error;
      // Native fiscal cash does not trade currencies. Legacy flag-off worlds
      // retain native receipts without inventing an unavailable anchor value.
      return { anchorRate: null, anchorRateSource: "unpriced", anchorRatePreset: preset };
    }
  }
  // Shadow qualification validates the entire cohort before any cash accrues.
  // A missing rate cannot partially advance an earlier, valid treasury.
  if (ledgerShadow) for (const budget of budgets) valuationFor(budget);

  let countriesProcessed = 0;
  for (const initial of budgets) {
    let b = initial;
    if (!liveCountries.has(String(b.countryId ?? b._id))) {
      if (treasuryCashLedgerEnabled && b.sovereignCouponClaims?.length) {
        await settleFundedSovereignCoupons(db, b, {
          turn: _turn,
          bonds: [],
          anchorRate: b.sovereignCouponClaims[0].anchorRate,
          forexEnabled: await isForexEnabled(),
          fxByCurrency: new Map(
            [...rateByCurrency].map(([currency, rate]) => [currency as CurrencyCode, rate])
          ),
        });
      }
      continue;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (b.treasuryAccrual) {
        await publishTreasuryAccrualReceipt(db, b, b.treasuryAccrual);
        if (b.treasuryAccrual.turn >= _turn) {
          if (b.bankSovereignClaims?.length) {
            await settleBankSovereignClaims(db, b, _turn);
          }
          if (treasuryCashLedgerEnabled) {
            const valuation = valuationFor(b);
            if (!Number.isFinite(valuation.anchorRate) || (valuation.anchorRate ?? 0) <= 0)
              throw new Error(
                `Cannot fund sovereign coupon claims for ${b.countryId}: missing native FX quote`
              );
            await settleFundedSovereignCoupons(db, b, {
              turn: _turn,
              bonds: sovereignBonds.filter(
                (bond) => String(bond.countryId) === String(b.countryId)
              ),
              anchorRate: valuation.anchorRate!,
              forexEnabled: await isForexEnabled(),
              fxByCurrency: new Map(
                [...rateByCurrency].map(([currency, rate]) => [currency as CurrencyCode, rate])
              ),
            });
          }
          break;
        }
      }
      // Invariant: every federalBudget carries a signed treasuryBalance (set at
      // creation + backfilled). If one is still null, heal it in place to zero so
      // the country starts accruing this turn instead of freezing, and surface
      // the gap in logs. The heal is zero, never bond debt: cash and
      // `debt.principal` are separate positions, and fabricating a cash hole from
      // the bond stock would invent an obligation payment that never happened
      // (refs #1975).
      let current = b.treasuryBalance;
      if (current == null) {
        current = 0;
        console.warn(
          `[treasuryTurn] ${String(b._id)} had null treasuryBalance; ` +
            `initializing to 0 (cash unknown; bond stock untouched). Seed/backfill missed this budget.`
        );
      }

      await expireFinancialCrisisAusterity(db, b, _turn);
      const revenue = b.revenue?.total ?? 0;
      const spendingTotal = b.spending?.total ?? 0;
      const debtInterest = b.spending?.debtInterest ?? 0;

      // Live debt-service on the bond-owned stock (the per-turn cash leg of coupon
      // service). Uses the PRE-slice stock so the rate reflects this turn's opening
      // position. Never touches `debt.principal` itself.
      const bondPrincipal = Math.max(0, b.debt?.principal ?? 0);
      const terms = sovereignDebtTerms(bondPrincipal, {
        gdp: b.gdp ?? 0,
        gdpSmoothed: b.gdpSmoothed,
        investorConfidence: b.investorConfidence,
        imfBailoutActive: b.imfSovereignBailoutActive,
        sovereignRiskAnchor: b.sovereignRiskAnchor,
      });
      const debtServiceTurn =
        bondPrincipal > 0 ? (bondPrincipal * terms.interestRate) / TURNS_PER_YEAR : 0;

      const enforcementCost = enforcementTreasuryCostPerTurn(
        b.gdp ?? 0,
        b.unionsBanned === true,
        b.unionEnforcementPosture
      );
      const currencyCode = resolveCountryCurrencyCode(b) ?? "USD";
      const valuation = valuationFor(b);
      const bankCouponPlan = bankTreasuryEnabled
        ? bankCouponPlanForCountry(sovereignBonds, String(b.countryId ?? b._id), currencyCode)
        : [];
      const bankCouponAmount = bankCouponPlan.reduce((sum, plan) => sum + plan.amountLocal, 0);
      const accrualInput = {
        turn: _turn,
        openingCash: current,
        currencyCode,
        ...valuation,
        ledgerShadow,
        annualRevenue: revenue,
        annualPrimarySpending: spendingTotal - debtInterest,
        debtService: debtServiceTurn,
        enforcement: enforcementCost,
      };
      const accrualReceipt = treasuryAccrualWithBankCouponReserve(accrualInput, bankCouponAmount);
      const receipt: TreasuryAccrualReceipt = {
        ...accrualReceipt,
        ...(treasuryCashLedgerEnabled ? { treasuryCashLedgerEnabled: true } : {}),
        ...(bankTreasuryEnabled
          ? {
              bankCouponPlan: bankCouponPlan.map(
                ({ bankId, charteredTurn, amountLocal, bondIds }) => ({
                  bankId,
                  charteredTurn,
                  amountLocal,
                  bondIds,
                })
              ),
            }
          : {}),
      };
      const existingClaims = b.bankSovereignClaims ?? [];
      const claimById = new Map(existingClaims.map((claim) => [claim.id, claim]));
      for (const plan of bankCouponPlan) {
        const claim = bankCouponClaim({
          countryId: String(b.countryId ?? b._id),
          currencyCode,
          turn: _turn,
          plan,
          anchorRate: valuation.anchorRate ?? undefined,
          ledgerShadow,
          treasuryCashLedgerEnabled: receipt.treasuryCashLedgerEnabled === true,
          ledgerCreatedAt: new Date(),
        });
        claimById.set(claim.id, claim);
      }
      const bankSovereignClaims = [...claimById.values()];
      const next = current + receipt.cashDelta;

      // Ticket #1102: walk any enacted tax-rate change one step toward its
      // target, so a large move arrives over several turns instead of shocking
      // the economy in one. Reached targets drop out of the map on their own.
      const ramp = advanceTaxRatePhaseIn(
        // FederalTaxRates is a fixed-key shape with no string index signature,
        // so widening needs the explicit two-step. The helper only reads keys it
        // was handed in `pending`, all of which are real tax types.
        (b.taxRates ?? {}) as unknown as Record<string, number | null | undefined>,
        b.taxRatePhaseIn as Record<string, number> | undefined
      );
      const rampSet: Record<string, number> = {};
      for (const [taxType, rate] of Object.entries(ramp.rates)) {
        rampSet[`taxRates.${taxType}`] = rate;
      }
      const rampUnset: Record<string, ""> = {};
      for (const taxType of Object.keys(b.taxRatePhaseIn ?? {})) {
        if (!(taxType in ramp.pending)) rampUnset[`taxRatePhaseIn.${taxType}`] = "";
      }

      const applied = await db.collection<FederalBudget>("federalBudget").updateOne(
        {
          _id: b._id,
          treasuryBalance: b.treasuryBalance ?? null,
          $or: [
            { "treasuryAccrual.turn": { $exists: false } },
            { "treasuryAccrual.turn": { $lt: _turn } },
          ],
        },
        {
          $set: {
            treasuryBalance: next,
            treasuryAccrual: receipt,
            ...(bankSovereignClaims.length > 0 ? { bankSovereignClaims } : {}),
            ...rampSet,
          },
          ...(Object.keys(rampUnset).length > 0 ? { $unset: rampUnset } : {}),
        }
      );
      if (applied.matchedCount === 1) {
        await publishTreasuryAccrualReceipt(db, b, receipt);
        if (bankSovereignClaims.length > 0) {
          await settleBankSovereignClaims(
            db,
            { _id: b._id, countryId: b.countryId, bankSovereignClaims },
            _turn
          );
        }
        if (treasuryCashLedgerEnabled) {
          const valuation = valuationFor(b);
          if (!Number.isFinite(valuation.anchorRate) || (valuation.anchorRate ?? 0) <= 0)
            throw new Error(
              `Cannot fund sovereign coupon claims for ${b.countryId}: missing native FX quote`
            );
          await settleFundedSovereignCoupons(
            db,
            { _id: b._id, countryId: b.countryId, sovereignCouponClaims: b.sovereignCouponClaims },
            {
              turn: _turn,
              bonds: sovereignBonds.filter(
                (bond) => String(bond.countryId) === String(b.countryId)
              ),
              anchorRate: valuation.anchorRate!,
              forexEnabled: await isForexEnabled(),
              fxByCurrency: new Map(
                [...rateByCurrency].map(([currency, rate]) => [currency as CurrencyCode, rate])
              ),
            }
          );
        }
        countriesProcessed += 1;
        break;
      }
      const refreshed = await db.collection<FederalBudget>("federalBudget").findOne({ _id: b._id });
      if (!refreshed) throw new Error(`Treasury budget ${b._id} disappeared during accrual`);
      b = refreshed;
      if (attempt === 3) throw new Error(`Treasury accrual ${b._id}:${_turn} could not claim cash`);
    }
  }
  return { countriesProcessed };
}
