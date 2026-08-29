import type { RegionKey } from "@/lib/referendum/transfer/regionScopedCollections";

/**
 * How a single-region aggregate's data fans out across the seeded sub-regions
 * when a UK nation-region (SCO/WAL) secedes:
 *
 *  - cloneIdentical   — copy the aggregate doc to each sub-region unchanged
 *                       (snapshots that diverge over later turns). Delete aggregate.
 *  - scaleCounts      — clone per sub-region, splitting each `countVectorFields`
 *                       count vector by population weight (conserving). Delete aggregate.
 *  - copyDoc          — clone verbatim per sub-region (rate/profile docs). Delete aggregate.
 *  - apportionShares  — clone per sub-region, replacing the voter-archetype
 *                       `groups` split with a per-region tilt off the live
 *                       aggregate (preset pattern; preserves the aggregate).
 *                       Delete aggregate.
 *  - scaleNumeric     — clone per sub-region, scaling every numeric field by GDP
 *                       weight (budgets). Delete aggregate.
 *  - partitionGdp     — distribute the many docs across sub-regions by GDP weight
 *                       (sectors, weighted on `revenue`), re-`stateId`-ing each.
 *  - rekeyCopyShares  — re-key the composite-`_id` doc per sub-region, copying its
 *                       percentage shares (not counts). Delete the old composite doc.
 *  - rehomeCapital    — move the single-region docs onto the capital sub-region
 *                       (residents also flip `countryId`).
 */
export type FanoutPolicy =
  | "cloneIdentical"
  | "scaleCounts"
  | "copyDoc"
  | "apportionShares"
  | "scaleNumeric"
  | "partitionGdp"
  | "rekeyCopyShares"
  | "rehomeCapital";

export interface FanoutScope {
  collection: string;
  key: RegionKey;
  policy: FanoutPolicy;
  /** Dot-paths to count vectors scaled by population weight (scaleCounts only). */
  countVectorFields?: string[];
  /**
   * Field paths whose magnitudes scale by GDP weight (scaleNumeric only). Listed
   * explicitly because budget docs mix extensive magnitudes (revenue, totals —
   * scale) with intensive values (rates, per-capita, baselines, years — copy).
   */
  scaleFields?: string[];
}

const rehome = (collection: string): FanoutScope => ({
  collection,
  key: "stateIdField",
  policy: "rehomeCapital",
});

/**
 * SSOT mapping every `REGION_SCOPED_COLLECTIONS` entry to its secession fan-out
 * rule. A coverage test asserts 1:1 parity with the transfer SSOT.
 */
export const SECEDE_FANOUT: FanoutScope[] = [
  // ── devolved-government + political/character artifacts → re-home to capital ──
  rehome("statePolicies"),
  rehome("stateBills"),
  rehome("governorOfficeState"),
  rehome("governorLegislationQueue"),
  rehome("governorExecutiveOrders"),
  rehome("governorAddresses"),
  rehome("governorEndorsements"),
  rehome("executiveEndorsements"),
  rehome("stateResourceCapacity"),
  rehome("stateApprovalHistory"),
  rehome("characterStateOrg"),
  rehome("nppInfluenceAttempts"),
  rehome("subsidies"),
  // ── economic sectors → distribute across sub-regions by GDP (revenue) ────────
  { collection: "corporateSectors", key: "stateIdField", policy: "partitionGdp" },
  { collection: "unownedSectors", key: "stateIdField", policy: "partitionGdp" },
  // ── one-doc-per-region (_id IS the region id) ───────────────────────────────
  // Both halves of a region's metrics, not just the macro one: the political
  // BOARD is where approval, corp margins and crisis triggers are scored from,
  // so a sub-region without one reads as unseeded everywhere at once. Cloning
  // identically is right for both — every value on them is intensive (a rate, a
  // 0-100 score), so a split does not divide it.
  { collection: "macroMetrics", key: "idIsState", policy: "cloneIdentical" },
  { collection: "politicalMetrics", key: "idIsState", policy: "cloneIdentical" },
  {
    collection: "regionDemographics",
    key: "idIsState",
    policy: "scaleCounts",
    countVectorFields: ["ages.male", "ages.female"],
  },
  { collection: "stateDemographicTurnout", key: "idIsState", policy: "copyDoc" },
  // Differentiate each sub-region's archetype split off the live aggregate
  // (per-region preset pattern); see apportionDemographicShares.
  { collection: "stateDemographics", key: "idIsState", policy: "apportionShares" },
  { collection: "demographicDefaults", key: "idIsState", policy: "copyDoc" },
  {
    collection: "regionalBudgets",
    key: "idIsState",
    policy: "scaleNumeric",
    // UK (SCO/WAL) magnitude fields; per-capita/baseline + bool/turn counters copy.
    scaleFields: [
      "councilTaxRevenue",
      "businessRatesRevenue",
      "westminsterGrant",
      "totalBudget",
      "enactedBillCosts",
      "subsidyCosts",
      "surplus",
    ],
  },
  {
    collection: "stateBudgets",
    key: "idIsState",
    policy: "scaleNumeric",
    // Nested magnitude objects scale wholesale; taxRates/fiscalYear copy.
    scaleFields: ["revenue", "taxBases", "spending", "balance", "surplus", "stateGdp"],
  },
  // ── composite-key (_id is `${countryId}_${stateId}`) → re-key + copy shares ──
  { collection: "stateRegistrationPool", key: "compositeCountryState", policy: "rekeyCopyShares" },
  // ── historical records → re-home to capital, never split ─────────────────────
  // These joined the transfer SSOT for the COUNTRY MERGE, which cannot leave them
  // pointing at a country that has stopped existing. Their secession policy is
  // `rehomeCapital` for a different reason: every one of them is a RECORD of
  // something that already happened in the aggregate region — a law that was
  // enacted, an election that was held, a survey that was run. Splitting or
  // scaling a record would fabricate history that did not occur in the
  // sub-region it was handed to, so the whole set moves to the capital intact.
  rehome("enactedLaws"),
  { collection: "electionVoteTallies", key: "stateField", policy: "rehomeCapital" },
  { collection: "elections", key: "stateField", policy: "rehomeCapital" },
  rehome("statePartyCandidates"),
  { collection: "recruitmentSlates", key: "stateField", policy: "rehomeCapital" },
  // Keyed by the candidate's RESIDENCY, like `characters`, not by a slate region.
  { collection: "slateCandidates", key: "homeStateField", policy: "rehomeCapital" },
  rehome("prospectingSurveys"),
  // ── residents (flip countryId, re-home to capital) ──────────────────────────
  { collection: "characters", key: "homeStateField", policy: "rehomeCapital" },
];
