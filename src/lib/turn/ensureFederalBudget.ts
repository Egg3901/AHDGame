/**
 * Self-heal for a missing `federalBudget` document.
 *
 * A world normally gets its federalBudget docs from `seedBudgets()` during
 * full bootstrap. Worlds created via a partial seed path (e.g.
 * `scripts/seed-sandbox.ts`, which creates `centralBanks` directly via
 * `ensureCentralBank()` without ever calling `seedBudgets`) can end up with a
 * country that has a live central bank but no federal budget at all.
 * Every downstream consumer (`treasuryTurn`, `inflationRecalc`) previously
 * just skipped such a country silently (`if (!budget) continue`), so the gap
 * never surfaced as an error — `gameHealthSnapshots` showed the phase
 * "completed" every turn while the country was simply never processed.
 *
 * `ensureFederalBudget` closes the gap the moment it's noticed: create the
 * preset's default budget document on first encounter so the country starts
 * accruing fiscal history immediately, instead of forever.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

/** Per-process dedup so the unexpected-miss warning fires once, not every turn. */
const warnedUnexpectedMisses = new Set<string>();

export async function ensureFederalBudget(
  db: Db,
  countryId: CountryId,
  preset: string
): Promise<FederalBudget | null> {
  const budgetId = getNationalBudgetId(countryId);
  const existing = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (existing) return existing;

  const { getInitialNationalBudgetsForPreset } = await import("@/lib/seeds/reference/budgets");
  const defaultBudget = getInitialNationalBudgetsForPreset(preset).find(
    (b) => b.countryId === countryId
  );
  if (!defaultBudget) {
    // Preset-aware central-bank seeding (#2073) keeps known currency-only
    // countries out of this path. A miss here is therefore always unexpected.
    const dedupKey = `${preset}:${countryId}`;
    if (!warnedUnexpectedMisses.has(dedupKey)) {
      warnedUnexpectedMisses.add(dedupKey);
      console.warn(
        `[ensureFederalBudget] no default budget seed for ${countryId} under preset "${preset}"; ` +
          `cannot self-heal (unexpected; see #2073 monetary coverage)`
      );
    }
    return null;
  }

  const { _id, ...budgetData } = defaultBudget;
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { _id },
      { $setOnInsert: { ...budgetData, updatedAt: new Date() } },
      { upsert: true }
    );
  console.warn(
    `[ensureFederalBudget] ${countryId} had a centralBanks doc but no federalBudget ` +
      `(_id="${budgetId}") — seeded default from preset "${preset}". This world was ` +
      `likely bootstrapped via a partial seed path; check scripts/seed-sandbox.ts.`
  );
  return db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
}

/**
 * Read-only cross-check of every `centralBanks` doc against `federalBudget`,
 * used by the gameHealthSnapshot integrity check so a missing budget surfaces
 * as a data-integrity error instead of turns silently no-oping.
 */
export async function findCountriesMissingFederalBudget(db: Db): Promise<string[]> {
  const banks = await db
    .collection("centralBanks")
    .find({}, { projection: { countryId: 1 } })
    .toArray();
  if (banks.length === 0) return [];
  const budgetIds = banks.map((bank) => getNationalBudgetId(bank.countryId as CountryId));
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ _id: { $in: budgetIds } }, { projection: { _id: 1 } })
    .toArray();
  const present = new Set(budgets.map((budget) => String(budget._id)));
  return banks
    .filter((_, index) => !present.has(budgetIds[index]))
    .map((bank) => bank.countryId as string);
}

/**
 * Read-only check for the *other* half of the sandbox-seed-audit-t101 bug:
 * a federalBudget doc can exist and be actively updated every turn while its
 * own `countryId` field points at the wrong country. The sandbox's `_id:
 * "federal"` doc (which `getNationalBudgetId("US")` resolves to, and which
 * inflationRecalc/treasuryTurn correctly join on by `_id`) had `countryId:
 * "BAL"` — so every OTHER consumer that derives a country from
 * `budget.countryId` instead of the `_id`/legacy-fallback convention (e.g.
 * `sovereign.ts`, `fiscalYear.ts`, `corporationDetail.ts`) would misattribute
 * this budget to BAL instead of US. `_id === "federal"` is the one legacy
 * exception (must map to US); every other budget's `_id` IS its country code.
 */
export async function findFederalBudgetCountryMismatches(
  db: Db
): Promise<{ budgetId: string; expectedCountryId: string; actualCountryId: string | undefined }[]> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({}, { projection: { countryId: 1 } })
    .toArray();
  const mismatches: {
    budgetId: string;
    expectedCountryId: string;
    actualCountryId: string | undefined;
  }[] = [];
  for (const budget of budgets) {
    const budgetId = String(budget._id);
    const expectedCountryId = budgetId === "federal" ? "US" : budgetId;
    if (budget.countryId !== expectedCountryId) {
      mismatches.push({ budgetId, expectedCountryId, actualCountryId: budget.countryId });
    }
  }
  return mismatches;
}
