/**
 * Bill categories and mapping to legislation type policy domains.
 * Category is required; it limits which legislation types (and thus policies) can be added.
 */

export const BILL_CATEGORIES = [
  "defense",
  "economy",
  "education",
  "environment",
  "foreign policy",
  "healthcare",
  "industry",
  "immigration",
  "infrastructure",
  "public safety",
  "social",
  "tax",
  "trade",
  "agriculture",
  "technology",
  "state ownership",
  "custom",
] as const;

export type BillCategory = (typeof BILL_CATEGORIES)[number];

/** Categories that use tariff provisions instead of policy provisions */
export const TARIFF_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set(["trade"]);

/** Categories that use subsidy provisions instead of policy provisions */
export const SUBSIDY_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set(["industry"]);

/** Categories that use nationalization provisions (nationalize / privatize / designate strategic). */
export const NATIONALIZATION_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set([
  "state ownership",
]);

/** Categories that use union-law provisions (v3 Phase 7b) instead of policy provisions. */
export const UNION_LAW_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set(["industry"]);

/**
 * Categories that use electoral-law provisions (franchise + registration
 * access). "social" is where governance/government policy already maps, and
 * there is no dedicated elections category.
 */
export const ELECTORAL_LAW_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set(["social"]);

/**
 * Categories that may carry a central-bank-independence provision. "economy"
 * is where monetary and banking policy already maps.
 */
export const CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES: ReadonlySet<BillCategory> = new Set([
  "economy",
]);

/** Categories available for state legislature bills (excludes national-only categories) */
export const STATE_BILL_CATEGORIES = [
  "economy",
  "education",
  "environment",
  "healthcare",
  "industry",
  "infrastructure",
  "public safety",
  "social",
  "tax",
  "agriculture",
  "custom",
] as const;

/** Maps form category to policyDomain(s) in legislation types. Trade is excluded — it uses tariff provisions instead. */
export const CATEGORY_TO_POLICY_DOMAINS: Partial<Record<BillCategory, string[]>> = {
  agriculture: ["agriculture"],
  tax: ["tax"],
  economy: ["economic", "economy", "labor", "labour"],
  healthcare: ["healthcare"],
  education: ["education"],
  infrastructure: ["infrastructure", "transport"],
  environment: ["environment"],
  "public safety": ["publicSafety", "law_justice"],
  immigration: ["immigration"],
  social: ["social", "governance", "mediaInformation", "government"],
  defense: ["defense"],
  "foreign policy": ["foreign_policy"],
  technology: ["technology"],
};

/**
 * Whether a bill category has proposable content given a country's available
 * legislation types. Trade (tariff) and industry (subsidy) categories always
 * qualify — they use their own provision builders rather than legislation types.
 * Every other category qualifies only when at least one legislation type maps to
 * one of its policy domains.
 *
 * Lets the Propose Legislation modals hide categories a country has no laws for
 * (e.g. agriculture / technology in the UK and US, which have no such laws),
 * while keeping them for countries that do (JP / DE / CN).
 */
export function categoryHasProposableContent(
  category: BillCategory,
  legislationTypes: ReadonlyArray<{ policyDomain: string }>
): boolean {
  // Custom (flavor/roleplay) bills carry no provisions, so they are always
  // proposable regardless of which legislation types a country has.
  if (category === "custom") return true;
  if (TARIFF_BILL_CATEGORIES.has(category) || SUBSIDY_BILL_CATEGORIES.has(category)) {
    return true;
  }
  const domains = CATEGORY_TO_POLICY_DOMAINS[category] ?? [];
  if (domains.length === 0) return true;
  return legislationTypes.some((lt) => domains.includes(lt.policyDomain));
}

/**
 * Subset of BILL_CATEGORIES proposable for a country given its legislation types.
 * Returns all categories while types are still loading (empty input) so the
 * category selector doesn't flash empty.
 */
export function getProposableBillCategories(
  legislationTypes: ReadonlyArray<{ policyDomain: string }>
): BillCategory[] {
  if (legislationTypes.length === 0) return [...BILL_CATEGORIES];
  return BILL_CATEGORIES.filter((c) => categoryHasProposableContent(c, legislationTypes));
}

/** National influence cost per provision: 1st = 5, 2nd = 10, 3rd = 15. */
export const PROVISION_COSTS = [5, 10, 15] as const;

/** Max number of provisions per bill. */
export const MAX_PROVISIONS = 3;

/** Flat action point cost to propose any bill (national or state). */
export const BILL_PROPOSE_ACTION_COST = 10;

/** Total national influence cost for n provisions (sum of PROVISION_COSTS[0..n-1]). */
export function getProvisionCostTotal(numProvisions: number): number {
  if (numProvisions <= 0) return 0;
  let total = 0;
  for (let i = 0; i < numProvisions && i < PROVISION_COSTS.length; i++) {
    total += PROVISION_COSTS[i];
  }
  return total;
}

/**
 * How many provisions count toward national political influence (NPI) when proposing a bill.
 * Policy provisions always count. Subsidy/end_subsidy rows (industry bills) use the same ladder.
 * Union-law rows (v3 Phase 7b) use the same ladder too — a union-law-only bill must cost NPI
 * like any other single-provision industry bill; omitting it here was a real bug (verified
 * fix — a union-law-only bill previously enacted a nationwide ±30pp unionization swing for
 * free). Tariff rows are excluded — trade tariffs do not spend NPI.
 */
export function countProvisionsChargedNationalInfluence(args: {
  policyProvisionCount: number;
  subsidyProvisionCount: number;
  unionLawProvisionCount?: number;
  /**
   * Provisions that carry a bill on their own: central-bank independence, and
   * electoral law (franchise / registration access). They use the same ladder
   * for the same reason union-law rows do. Left uncharged, a statute that moves
   * monetary authority between the government and the bank, or rewrites who may
   * vote, was the one kind of bill that cost its sponsor nothing at all, and a
   * bill carrying one alongside an ordinary policy row cost strictly more than
   * the same statute proposed by itself.
   */
  standaloneProvisionCount?: number;
}): number {
  return Math.max(
    0,
    args.policyProvisionCount +
      args.subsidyProvisionCount +
      (args.unionLawProvisionCount ?? 0) +
      (args.standaloneProvisionCount ?? 0)
  );
}
