import { getDb } from "@/lib/mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { GameState } from "@/lib/db/types/gameState";
import type { CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Per-turn fiscal accrual (spec §4). For each country's federalBudget, move a
 * 1/TURNS_PER_YEAR slice of the current primary balance (revenue minus spending
 * excluding debt interest) into the signed treasuryBalance, then deduct live
 * debt-service while in the hole, and resync the derived fiscal fields. Replaces
 * the annual deficit jump that processFiscalYear/processAnnualDebt used to apply.
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

  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();

  let countriesProcessed = 0;
  for (const b of budgets) {
    // Invariant: every federalBudget carries a signed treasuryBalance (set at
    // creation + backfilled). If one is still null, heal it in place from the
    // canonical fiscal position (−debt.principal) so the country starts accruing
    // this turn instead of freezing — and surface the gap in logs.
    let current = b.treasuryBalance;
    if (current == null) {
      current = -(b.debt?.principal ?? 0);
      console.warn(
        `[treasuryTurn] ${String(b._id)} had null treasuryBalance; ` +
          `initializing to ${current} (=-debt.principal). Seed/backfill missed this budget.`
      );
    }

    const revenue = b.revenue?.total ?? 0;
    const spendingTotal = b.spending?.total ?? 0;
    const debtInterest = b.spending?.debtInterest ?? 0;
    const primaryPerTurn = (revenue - (spendingTotal - debtInterest)) / TURNS_PER_YEAR;

    // Live debt-service: only while negative. Use the PRE-slice debt so the rate
    // reflects this turn's opening position.
    const pre = deriveFiscalState({
      treasuryBalance: current,
      gdp: b.gdp ?? 0,
      gdpSmoothed: b.gdpSmoothed,
      ceiling: b.debt?.ceiling ?? 0,
      investorConfidence: b.investorConfidence,
      imfBailoutActive: b.imfSovereignBailoutActive,
      sovereignRiskAnchor: b.sovereignRiskAnchor,
    });
    const debtServiceTurn =
      pre.principal > 0 ? (pre.principal * pre.interestRate) / TURNS_PER_YEAR : 0;

    const next = Math.round(current + primaryPerTurn - debtServiceTurn);
    const derived = deriveFiscalState({
      treasuryBalance: next,
      gdp: b.gdp ?? 0,
      gdpSmoothed: b.gdpSmoothed,
      ceiling: b.debt?.ceiling ?? 0,
      investorConfidence: b.investorConfidence,
      imfBailoutActive: b.imfSovereignBailoutActive,
      sovereignRiskAnchor: b.sovereignRiskAnchor,
    });

    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: b._id },
      {
        $set: {
          treasuryBalance: next,
          "debt.principal": derived.principal,
          "debt.interestRate": derived.interestRate,
          debtToGdpRatio: derived.debtToGdpRatio,
          creditRating: derived.creditRating,
        },
      }
    );
    countriesProcessed += 1;
  }
  return { countriesProcessed };
}
