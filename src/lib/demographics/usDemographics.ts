import type { DemographicGroup } from "@/lib/utils/demographicAlignment";

/**
 * US Layer-1 demographics with their political leans.
 * Based on political science research and voter behavior patterns.
 *
 * Lives in its own module (rather than `demographicAlignment.ts`) so the
 * country demographics SSOT can import it without creating a runtime import
 * cycle: `demographicAlignment` → `countryDemographics` (SSOT) → `usDemographics`,
 * one direction only. `demographicAlignment` re-exports this for backward
 * compatibility.
 */
export const LAYER1_DEMOGRAPHICS: DemographicGroup[] = [
  // Race
  { category: "race", group: "white", economicLean: 1, socialLean: 1 },
  { category: "race", group: "black", economicLean: -4, socialLean: -2 },
  { category: "race", group: "hispanic", economicLean: -2, socialLean: -1 },
  { category: "race", group: "asian", economicLean: 0, socialLean: 0 },
  { category: "race", group: "other", economicLean: 0, socialLean: 0 },
  // Age
  { category: "age", group: "young", economicLean: -3, socialLean: -3 },
  { category: "age", group: "mid", economicLean: 0, socialLean: 0 },
  { category: "age", group: "mature", economicLean: 2, socialLean: 2 },
  { category: "age", group: "senior", economicLean: 2, socialLean: 3 },
  // Education
  { category: "education", group: "no_college", economicLean: 2, socialLean: 2 },
  { category: "education", group: "college", economicLean: -1, socialLean: -2 },
  { category: "education", group: "graduate", economicLean: -3, socialLean: -3 },
  // Wealth
  { category: "wealth", group: "low", economicLean: -3, socialLean: 0 },
  { category: "wealth", group: "middle", economicLean: 0, socialLean: 0 },
  { category: "wealth", group: "high", economicLean: 4, socialLean: 1 },
  // Ideology
  { category: "ideology", group: "evangelicals", economicLean: 4, socialLean: 5 },
  { category: "ideology", group: "environmentalists", economicLean: -3, socialLean: -4 },
  { category: "ideology", group: "libertarians", economicLean: 5, socialLean: -2 },
  { category: "ideology", group: "progressives", economicLean: -5, socialLean: -5 },
  { category: "ideology", group: "patriots", economicLean: 4, socialLean: 4 },
  { category: "ideology", group: "gunowners", economicLean: 3, socialLean: 4 },
];
