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

/**
 * Countries that legitimately have a central bank / corporations seeded under a
 * given preset but for which `NATIONAL_BUDGET_SEED_CONFIGS_*` intentionally has
 * no row yet, so `ensureFederalBudget` cannot self-heal. These are a KNOWN,
 * expected gap — national budgets are flagged off on 1991 worlds and the
 * remaining Cold-War budget seeds are deliberately deferred (see GH #3038).
 * Emitting a per-turn warn for each of them just spams the logs every turn.
 *
 * A missing seed for a country NOT in this set is genuinely unexpected and
 * still warns (once per process, to avoid a per-turn flood while staying loud
 * enough to notice).
 */
const KNOWN_UNSEEDED_BUDGET_COUNTRIES: Partial<Record<string, ReadonlySet<CountryId>>> = {
  "1991-default": new Set<CountryId>([
    "CS",
    "ES",
    "TR",
    "GR",
    "AT",
    "FI",
    "RO",
    "UKR",
    "BLR",
    "BAL",
    "FR",
    "SE",
    "IT",
    "DD",
    "RU",
    "PL",
    "HU",
    "YU",
    "BG",
  ]),
  // The 2019 seed array covers only US/UK/JP/DE/IE/BR/CN/NG, so every other
  // country with a defense seat misses here. Deliberate — the same deferral as
  // 1991 (GH #3038) — and without this key each miss takes the "genuinely
  // unexpected" branch and warns once per process per country.
  "2019-default": new Set<CountryId>([
    "RU",
    // Union republics: era-gated to 1953/1979 like the satellites, so a 1991 or
    // 2019 world seeds no republican budget for them by design.
    "UKR",
    "BLR",
    "BAL",
    "PL",
    "HU",
    "RO",
    "BG",
    "FR",
    "IT",
    "ES",
    "SE",
    "TR",
    "GR",
    "AT",
    "FI",
  ]),
};

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
    const isKnownDeferred = KNOWN_UNSEEDED_BUDGET_COUNTRIES[preset]?.has(countryId) ?? false;
    if (isKnownDeferred) {
      // Expected, deferred gap (GH #3038). Keep it informative but quiet — debug
      // level so it never reaches warn/error log sinks and stops spamming.
      console.debug(
        `[ensureFederalBudget] no default budget seed for ${countryId} under preset "${preset}" — ` +
          `known deferred (national budgets flagged off on 1991 worlds; see GH #3038); skipping self-heal`
      );
    } else {
      // Genuinely unexpected missing seed — still warn, but once per process so
      // it doesn't flood the logs every turn.
      const dedupKey = `${preset}:${countryId}`;
      if (!warnedUnexpectedMisses.has(dedupKey)) {
        warnedUnexpectedMisses.add(dedupKey);
        console.warn(
          `[ensureFederalBudget] no default budget seed for ${countryId} under preset "${preset}" — ` +
            `cannot self-heal (unexpected; not in the known-deferred set)`
        );
      }
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
  const missing: string[] = [];
  for (const bank of banks) {
    const countryId = bank.countryId as CountryId;
    const budgetId = getNationalBudgetId(countryId);
    const exists = await db
      .collection<FederalBudget>("federalBudget")
      .countDocuments({ _id: budgetId }, { limit: 1 });
    if (!exists) missing.push(countryId);
  }
  return missing;
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
