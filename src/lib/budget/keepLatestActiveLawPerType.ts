import type { EnactedLaw } from "@/lib/db/types/budget";
import { logWarning } from "@/lib/utils/errorLog";

/**
 * A country may hold only ONE active law per legislation type (and one per type
 * per state for state scope). Data races have left multiple concurrent
 * unrepealed rows of the same type, which the spending sums then multi-count
 * (#3148 — IE had 3 live ie_healthcare_policy rows). Keep only the
 * most-recently-enacted law per (legislationTypeId, stateId) so each policy is
 * costed once. A healthy world (0-1 rows per key) is unaffected.
 *
 * Lives in its own module because BOTH halves of the budget need it: the
 * spending side to cost each law once, and the revenue side to credit each v2
 * law's `gdpRevenueFraction` once. Importing it from `spending.ts` made
 * `revenue.ts` depend on that module for a pure helper, which broke every test
 * that mocks `./spending` wholesale.
 */
export function keepLatestActiveLawPerType(laws: EnactedLaw[]): EnactedLaw[] {
  const byKey = new Map<string, EnactedLaw>();
  let collapsed = 0;
  for (const [index, law] of laws.entries()) {
    // A row with no `legislationTypeId` cannot be shown to duplicate anything —
    // "same type" is the whole claim this dedupe rests on. Keying those together
    // collapsed every untyped row into one, which is a silent revenue/spending
    // loss rather than a de-duplication. Give each its own key instead.
    const key =
      law.legislationTypeId == null
        ? `untyped:${index}`
        : `${law.legislationTypeId}::${law.stateId ?? "national"}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, law);
    } else {
      collapsed++;
      if (law.enactedAt > existing.enactedAt) byKey.set(key, law);
    }
  }
  if (collapsed > 0) {
    logWarning("Collapsed duplicate active enactedLaws in spending sum (#3148)", {
      component: "BudgetSpending",
      action: "dedupe active laws",
      metadata: { collapsed, kept: byKey.size },
    });
  }
  return [...byKey.values()];
}
