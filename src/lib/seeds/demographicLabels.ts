/**
 * Display labels for the demographic dimensions.
 *
 * ⚠️ A LIGHT MODULE ON PURPOSE, AND IT MUST STAY IMPORT-FREE. This is the one
 * thing a browser needs out of the demographics tables: `GranularPollPanel` is a
 * `"use client"` component and wants twenty lines of label text.
 *
 * It lived in `demographicCategories.ts`, which was fine while that module had
 * no value imports. Extracting the United States' position overrides into
 * `us/data/usDemographicPositions.ts` gave it one -- and
 * `clientSafeLeafModules.test.ts` immediately failed, because the poll panel now
 * reached a module that pulls `shiftRegion` and 514 lines of state overrides into
 * the client bundle for a handful of strings.
 *
 * That is the failure the folder work already shipped once: `countryContinents.ts`
 * held `JP: "Asia"` at zero cost, was repointed at `JP_GEOGRAPHY.continent`, and
 * started dragging 108 KB into every bundle that read a continent, with typecheck,
 * lint and 38,000 tests all green. The answer both times is a sibling module with
 * nothing behind it.
 */
/**
 * Human-readable labels for each Layer-1 demographic sub-group.
 */
export const DEMOGRAPHIC_LABELS: Record<string, Record<string, string>> = {
  race: { white: "White", black: "Black", hispanic: "Hispanic", asian: "Asian", other: "Other" },
  age: {
    young: "Young (18–34)",
    mid: "Middle-Aged (35–49)",
    mature: "Mature (50–64)",
    senior: "Senior (65+)",
  },
  education: { no_college: "No College", college: "College Degree", graduate: "Graduate Degree" },
  wealth: { low: "Low Income", middle: "Middle Income", high: "High Income" },
};
