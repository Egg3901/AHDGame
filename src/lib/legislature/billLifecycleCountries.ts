/**
 * The countries whose national bills an engine actually walks, as a plain id set.
 *
 * `COUNTRY_BILL_PHASES` in `turn/countryPhases.ts` is the operational table and
 * remains the source of truth for RUNNING a lifecycle, but each of its entries
 * binds a runner function, so importing it drags in the entire bill-lifecycle
 * graph — and, through it, the world seed builders that construct budgets at
 * module load. Anything that only needs to ASK which countries have a lifecycle
 * pays that whole cost for a key set.
 *
 * That is not hypothetical: routing `hasBillLifecycle` through the operational
 * table put the turn engine behind the organisations query module, and five test
 * files that partially mock `@/lib/budget/costs` stopped being able to load at
 * all once a query module imported it.
 *
 * `__tests__/hasBillLifecycle.test.ts` asserts this set matches the table
 * exactly, in BOTH directions, so the two cannot drift: add a country to the
 * table and the test fails until it is added here, and an id here that no engine
 * walks fails too, because a bill minted for it would never close.
 */
import type { CountryId } from "@/lib/constants/countries";

/**
 * The 26 countries in `COUNTRY_BILL_PHASES`, PLUS the United States.
 *
 * The US lifecycle is invoked directly from `billLifecycle.ts` and is therefore
 * absent from that table — a bare table lookup silently excludes the game's most
 * important legislature, which is why `hasBillLifecycle` exists as a named
 * helper rather than as an inline check.
 */
export const BILL_LIFECYCLE_COUNTRY_IDS: ReadonlySet<CountryId> = new Set<CountryId>([
  "UK",
  "DE",
  "JP",
  "IE",
  "CN",
  "RU",
  "DD",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
  "UKR",
  "BLR",
  "BAL",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "AT",
  "FI",
  "GR",
  "BR",
  "NG",
  "US",
]);
