/**
 * Domain-Specific Archetype Affinities
 *
 * Defines how each voter archetype reacts to RIGHTWARD policy shifts in each domain.
 * Positive = likes rightward shifts, Negative = likes leftward shifts
 * Magnitude = how much they care about this domain (higher = stronger reaction)
 *
 * At bill enactment: impact = (newPosition - oldPosition) × affinity × scale
 * Example: Education shifts right by 2 positions, evangelical affinity is +35
 *          → evangelicals gain approval (rightward shift × positive affinity)
 */
import {
  JP_DOMAIN_AFFINITIES,
  DE_DOMAIN_AFFINITIES,
  CN_DOMAIN_AFFINITIES,
} from "./archetypeAffinitiesIntl";

export type PolicyDomain =
  | "education"
  | "healthcare"
  | "environment"
  | "immigration"
  | "criminal_justice"
  | "defense"
  | "economic"
  | "welfare"
  | "infrastructure"
  | "governance"
  | "foreign_policy"
  | "tax"
  | "mediaInformation"
  | "technology"
  | "agriculture";

export interface ArchetypeApprovalTemplate {
  young_renters?: number;
  evangelicals?: number;
  rural_traditionalists?: number;
  union_trades?: number;
  soccer_moms?: number;
  college_liberals?: number;
  small_business?: number;
  public_sector?: number;
  retirees?: number;
  libertarians?: number;
  new_immigrants?: number;
  secular_professionals?: number;
}

/** UK-specific archetype approval template. Positive = likes rightward policy shifts. */
export interface UKArchetypeApprovalTemplate {
  post_industrial_workers?: number;
  urban_progressives?: number;
  suburban_homeowners?: number;
  young_renters?: number;
  rural_traditionalists?: number;
  retirees?: number;
  public_sector?: number;
  moderate_centrists?: number;
  populist_right?: number;
  green_activists?: number;
  small_business?: number;
  new_britons?: number;
}

// Domain affinities: how each archetype reacts to RIGHTWARD shifts
// Positive = likes right, Negative = likes left, 0 = doesn't care
export const DOMAIN_AFFINITIES: Record<PolicyDomain, ArchetypeApprovalTemplate> = {
  // Placeholders — no archetype-approval data designed for these domains yet.
  // (No US agriculture/technology laws exist either; the propose modal hides
  // empty categories.) Fill in real affinities to enable approval previews.
  agriculture: {},
  technology: {},
  // EDUCATION: School choice vs public school funding
  // Evangelicals LOVE school choice (vouchers for religious schools)
  // Public sector HATES it (threatens teachers unions)
  education: {
    young_renters: -20,
    evangelicals: 35, // Vouchers fund religious schools!
    rural_traditionalists: 15, // Local control
    union_trades: -25, // Solidarity with teachers unions
    soccer_moms: -5, // Care about quality, mixed on approach
    college_liberals: -30,
    small_business: 20,
    public_sector: -40, // Teachers unions - existential threat
    retirees: 5,
    libertarians: 30, // School choice = freedom
    new_immigrants: -15, // Public schools help integration
    secular_professionals: -25,
  },

  // HEALTHCARE: Market-based vs government coverage
  // Retirees HATE cuts to Medicare
  // Small business has mixed feelings (costs vs freedom)
  healthcare: {
    young_renters: -30, // Often uninsured, want coverage
    evangelicals: 10, // Prefer charity over government
    rural_traditionalists: 15, // Self-reliance
    union_trades: -35, // Strong on healthcare
    soccer_moms: -10, // Kids' health
    college_liberals: -35,
    small_business: 15, // Less mandates, but costs...
    public_sector: -15,
    retirees: -40, // Don't touch my Medicare!
    libertarians: 40, // Against government healthcare
    new_immigrants: -20,
    secular_professionals: -20,
  },

  // ENVIRONMENT: Deregulation vs climate action
  // Most polarizing urban/rural split
  environment: {
    young_renters: -35, // Climate anxiety
    evangelicals: 15, // Skeptical of climate "religion"
    rural_traditionalists: 40, // Farming regs, energy jobs
    union_trades: -10, // Some in fossil fuels, some green jobs
    soccer_moms: -20, // Kids' future
    college_liberals: -45, // Core issue
    small_business: 25, // Compliance costs
    public_sector: -15,
    retirees: 10,
    libertarians: 35, // Against regulations
    new_immigrants: -5,
    secular_professionals: -30,
  },

  // IMMIGRATION: Enforcement vs pathways
  // Most divisive issue - new immigrants vs rural traditionalists
  immigration: {
    young_renters: -20,
    evangelicals: 5, // Conflicted - law vs compassion
    rural_traditionalists: 40, // Strong enforcement support
    union_trades: 5, // Mixed - wages vs solidarity
    soccer_moms: -10,
    college_liberals: -35,
    small_business: -10, // Need workers
    public_sector: -10,
    retirees: 20,
    libertarians: -15, // Open borders wing
    new_immigrants: -50, // Core issue - strongly oppose enforcement
    secular_professionals: -25,
  },

  // CRIMINAL JUSTICE: Tough on crime vs reform
  criminal_justice: {
    young_renters: -25,
    evangelicals: 15, // Law and order, but also forgiveness
    rural_traditionalists: 35, // Strong law and order
    union_trades: 5, // Police unions
    soccer_moms: 10, // Safety concerns
    college_liberals: -40, // Reform advocates
    small_business: 15, // Property protection
    public_sector: 0, // Police vs social workers
    retirees: 25, // Safety
    libertarians: -20, // Against police state
    new_immigrants: -20,
    secular_professionals: -25,
  },

  // DEFENSE: Military spending and intervention
  // Libertarians oppose BOTH directions (anti-intervention)
  defense: {
    young_renters: -20,
    evangelicals: 25, // Strong military, Israel support
    rural_traditionalists: 30, // Patriotism
    union_trades: -5, // Defense jobs, but prefer domestic
    soccer_moms: -15, // Anti-war
    college_liberals: -30,
    small_business: 10,
    public_sector: 0,
    retirees: 20, // Veterans
    libertarians: -25, // Anti-military spending AND intervention
    new_immigrants: -5,
    secular_professionals: -20,
  },

  // ECONOMIC: Tax cuts vs spending (general fiscal policy)
  economic: {
    young_renters: -25,
    evangelicals: 15,
    rural_traditionalists: 20,
    union_trades: -35, // Pro-worker policies
    soccer_moms: -5,
    college_liberals: -25,
    small_business: 40, // Tax cuts!
    public_sector: -35, // Government spending
    retirees: 10,
    libertarians: 45, // Strongly pro-tax cuts
    new_immigrants: -10,
    secular_professionals: -15,
  },

  // WELFARE: Social safety net cuts vs expansion
  welfare: {
    young_renters: -35, // Need housing help
    evangelicals: -5, // Charity, but also self-reliance
    rural_traditionalists: 25, // Self-reliance
    union_trades: -25,
    soccer_moms: -15,
    college_liberals: -30,
    small_business: 20,
    public_sector: -25,
    retirees: -20, // Protect their benefits
    libertarians: 35,
    new_immigrants: -25,
    secular_professionals: -20,
  },

  // INFRASTRUCTURE: Generally bipartisan, but privatization splits
  infrastructure: {
    young_renters: -15, // Public transit
    evangelicals: 5,
    rural_traditionalists: 10, // Rural roads
    union_trades: -35, // Construction jobs in public projects
    soccer_moms: -5,
    college_liberals: -15,
    small_business: 20, // Private contracts
    public_sector: -25,
    retirees: 5,
    libertarians: 20, // Privatization
    new_immigrants: -5,
    secular_professionals: -10,
  },

  // GOVERNANCE: Voting rights, civil rights, government structure
  governance: {
    young_renters: -25,
    evangelicals: 25, // Religious liberty focus
    rural_traditionalists: 30,
    union_trades: -15,
    soccer_moms: -10,
    college_liberals: -35,
    small_business: 15,
    public_sector: -20,
    retirees: 15,
    libertarians: 0, // Mixed - civil liberties vs voting restrictions
    new_immigrants: -35, // Voting rights, civil rights
    secular_professionals: -30,
  },

  // FOREIGN POLICY: Intervention vs isolationism
  foreign_policy: {
    young_renters: -15,
    evangelicals: 20, // Humanitarian, Israel
    rural_traditionalists: 25, // America first (but pro-military)
    union_trades: -10,
    soccer_moms: -10,
    college_liberals: -25,
    small_business: 10,
    public_sector: -10,
    retirees: 15,
    libertarians: 35, // Sovereigntist, anti-intervention
    new_immigrants: -10,
    secular_professionals: -15,
  },

  // TAX: Tax cuts vs progressive taxation
  // Small business and libertarians strongly favor cuts
  // Public sector and college liberals oppose
  tax: {
    young_renters: -20,
    evangelicals: 15,
    rural_traditionalists: 25,
    union_trades: -25,
    soccer_moms: -5,
    college_liberals: -30,
    small_business: 45,
    public_sector: -30,
    retirees: 15,
    libertarians: 50,
    new_immigrants: -10,
    secular_professionals: -15,
  },

  // MEDIA/INFORMATION: Deregulation vs content moderation
  // Evangelicals and rural traditionalists support deregulation
  // College liberals and secular professionals oppose
  mediaInformation: {
    young_renters: -20,
    evangelicals: 20,
    rural_traditionalists: 25,
    union_trades: -15,
    soccer_moms: -10,
    college_liberals: -35,
    small_business: 15,
    public_sector: -20,
    retirees: 10,
    libertarians: 5,
    new_immigrants: -15,
    secular_professionals: -25,
  },
};

/**
 * Map legislation type policyDomain to our domain categories
 */
export function getDomainForPolicyDomain(policyDomain: string): PolicyDomain {
  const domainMap: Record<string, PolicyDomain> = {
    education: "education",
    healthcare: "healthcare",
    environment: "environment",
    publicSafety: "criminal_justice",
    criminal_justice: "criminal_justice",
    defense: "defense",
    economic: "economic",
    social: "welfare",
    welfare: "welfare",
    labor: "economic",
    /** IE/UK British spelling — same routing as `labor` (US). */
    labour: "economic",
    /** IE/UK housing-domain types — closest semantic match is infrastructure. */
    housing: "infrastructure",
    infrastructure: "infrastructure",
    governance: "governance",
    foreign_policy: "foreign_policy",
    immigration: "immigration",
    tax: "tax",
    technology: "technology",
    agriculture: "agriculture",
    law_justice: "criminal_justice",
    mediaInformation: "mediaInformation",
  };
  return domainMap[policyDomain] ?? "economic";
}

/** Scale factor: shift × affinity gives raw impact, then we scale down */
export const SHIFT_IMPACT_SCALE = 0.15;

/**
 * UK domain affinities: how each UK archetype reacts to RIGHTWARD policy shifts.
 * Positive = likes rightward (more conservative/market-based) shifts.
 * Negative = likes leftward (more progressive/state-led) shifts.
 *
 * Calibrated to British political context (NHS, net zero, sovereignty, etc.)
 */
export const UK_DOMAIN_AFFINITIES: Record<PolicyDomain, UKArchetypeApprovalTemplate> = {
  // EDUCATION: School choice/academies vs public education funding
  // Public sector (teachers) most affected; rural traditionalists support local control
  education: {
    post_industrial_workers: -15,
    urban_progressives: -30,
    suburban_homeowners: 10,
    young_renters: -15,
    rural_traditionalists: 20,
    retirees: 5,
    public_sector: -45,
    moderate_centrists: -10,
    populist_right: 20,
    green_activists: -25,
    small_business: 15,
    new_britons: -20,
  },

  // HEALTHCARE: NHS funding/access vs privatisation
  // The NHS is the UK's sacred cow — most archetypes oppose rightward shifts
  healthcare: {
    post_industrial_workers: -30,
    urban_progressives: -35,
    suburban_homeowners: -5,
    young_renters: -25,
    rural_traditionalists: -10,
    retirees: -45,
    public_sector: -40,
    moderate_centrists: -20,
    populist_right: -15,
    green_activists: -30,
    small_business: 20,
    new_britons: -30,
  },

  // ENVIRONMENT: Climate action vs deregulation
  // UK context: net zero, green belt, onshore wind, farming regulations
  environment: {
    post_industrial_workers: -5,
    urban_progressives: -40,
    suburban_homeowners: 10,
    young_renters: -30,
    rural_traditionalists: 25,
    retirees: 10,
    public_sector: -20,
    moderate_centrists: -15,
    populist_right: 30,
    green_activists: -50,
    small_business: 20,
    new_britons: -10,
  },

  // IMMIGRATION: Enforcement/restrictions vs open pathways
  // UK context: Channel crossings, points-based system, asylum policy
  immigration: {
    post_industrial_workers: 20,
    urban_progressives: -35,
    suburban_homeowners: 15,
    young_renters: -15,
    rural_traditionalists: 40,
    retirees: 25,
    public_sector: -15,
    moderate_centrists: -5,
    populist_right: 50,
    green_activists: -30,
    small_business: -15,
    new_britons: -50,
  },

  // CRIMINAL JUSTICE: Tougher sentencing vs reform
  // UK context: knife crime, sentencing guidelines, prison overcrowding
  criminal_justice: {
    post_industrial_workers: 20,
    urban_progressives: -25,
    suburban_homeowners: 15,
    young_renters: -20,
    rural_traditionalists: 35,
    retirees: 30,
    public_sector: 0,
    moderate_centrists: -5,
    populist_right: 45,
    green_activists: -35,
    small_business: 15,
    new_britons: -25,
  },

  // DEFENSE: Military spending, NATO, nuclear deterrent
  // UK context: Trident, Ukraine, overseas commitments
  defense: {
    post_industrial_workers: 10,
    urban_progressives: -25,
    suburban_homeowners: 15,
    young_renters: -15,
    rural_traditionalists: 30,
    retirees: 25,
    public_sector: -10,
    moderate_centrists: 10,
    populist_right: 35,
    green_activists: -30,
    small_business: 10,
    new_britons: -15,
  },

  // ECONOMIC: Tax cuts vs public spending (fiscal policy)
  // UK context: austerity, national insurance, corporation tax
  economic: {
    post_industrial_workers: -20,
    urban_progressives: -25,
    suburban_homeowners: 25,
    young_renters: -20,
    rural_traditionalists: 15,
    retirees: 10,
    public_sector: -40,
    moderate_centrists: 5,
    populist_right: 10,
    green_activists: -30,
    small_business: 45,
    new_britons: -15,
  },

  // WELFARE: Benefits cuts vs expansion
  // UK context: universal credit, benefits cap, food banks
  welfare: {
    post_industrial_workers: -20,
    urban_progressives: -30,
    suburban_homeowners: 20,
    young_renters: -30,
    rural_traditionalists: 25,
    retirees: -10,
    public_sector: -30,
    moderate_centrists: -10,
    populist_right: 5,
    green_activists: -35,
    small_business: 25,
    new_britons: -30,
  },

  // INFRASTRUCTURE: Privatisation vs public investment
  // UK context: rail nationalisation, HS2, housing supply
  infrastructure: {
    post_industrial_workers: -20,
    urban_progressives: -20,
    suburban_homeowners: 5,
    young_renters: -25,
    rural_traditionalists: 5,
    retirees: -5,
    public_sector: -25,
    moderate_centrists: -10,
    populist_right: 0,
    green_activists: -20,
    small_business: 15,
    new_britons: -15,
  },

  // GOVERNANCE: Constitutional reform, civil rights, devolution, voting systems
  // UK context: proportional representation, Lords reform, devolution
  governance: {
    post_industrial_workers: -5,
    urban_progressives: -35,
    suburban_homeowners: 10,
    young_renters: -25,
    rural_traditionalists: 25,
    retirees: 20,
    public_sector: -20,
    moderate_centrists: -30,
    populist_right: 15,
    green_activists: -30,
    small_business: 10,
    new_britons: -30,
  },

  // FOREIGN POLICY: Sovereignty/interventionism vs internationalism
  // UK context: Brexit aftermath, Commonwealth, special relationship, Ukraine
  foreign_policy: {
    post_industrial_workers: 15,
    urban_progressives: -30,
    suburban_homeowners: 10,
    young_renters: -20,
    rural_traditionalists: 30,
    retirees: 25,
    public_sector: -15,
    moderate_centrists: -15,
    populist_right: 40,
    green_activists: -25,
    small_business: 5,
    new_britons: -20,
  },

  // TAX: Tax cuts vs progressive taxation
  // UK context: National Insurance, council tax, corporation tax
  tax: {
    post_industrial_workers: -20,
    urban_progressives: -25,
    suburban_homeowners: 20,
    young_renters: -25,
    rural_traditionalists: 20,
    retirees: 10,
    public_sector: -35,
    moderate_centrists: 0,
    populist_right: 15,
    green_activists: -30,
    small_business: 45,
    new_britons: -15,
  },

  // MEDIA/INFORMATION: Deregulation vs content moderation
  // UK context: BBC, Ofcom, online safety bill
  mediaInformation: {
    post_industrial_workers: 5,
    urban_progressives: -30,
    suburban_homeowners: 15,
    young_renters: -15,
    rural_traditionalists: 25,
    retirees: 15,
    public_sector: -20,
    moderate_centrists: -10,
    populist_right: 30,
    green_activists: -25,
    small_business: 10,
    new_britons: -20,
  },

  // TECHNOLOGY: State-led innovation vs market deregulation
  // UK context: R&D funding, tech regulation, digital economy
  technology: {
    post_industrial_workers: -10,
    urban_progressives: -30,
    suburban_homeowners: 5,
    young_renters: -20,
    rural_traditionalists: 15,
    retirees: 10,
    public_sector: -20,
    moderate_centrists: -5,
    populist_right: 10,
    green_activists: -15,
    small_business: 30,
    new_britons: -10,
  },

  // AGRICULTURE: Environmental regulation vs subsidies/deregulation
  // UK context: CAP replacement, farming subsidies, land use, food security
  agriculture: {
    post_industrial_workers: 5,
    urban_progressives: -20,
    suburban_homeowners: 0,
    young_renters: -15,
    rural_traditionalists: 45,
    retirees: 15,
    public_sector: -10,
    moderate_centrists: 5,
    populist_right: 20,
    green_activists: -35,
    small_business: 10,
    new_britons: -5,
  },
};

// JP / DE / CN affinity tables moved to archetypeAffinitiesIntl.ts (size cap);
// re-exported here so existing import paths keep working.
export { JP_DOMAIN_AFFINITIES, DE_DOMAIN_AFFINITIES, CN_DOMAIN_AFFINITIES };
export type {
  JPArchetypeApprovalTemplate,
  CNArchetypeApprovalTemplate,
  DEArchetypeApprovalTemplate,
} from "./archetypeAffinitiesIntl";

/** IE-specific archetype approval template. Positive = likes rightward policy shifts. */
export interface IEArchetypeApprovalTemplate {
  urban_professional?: number;
  rural_traditional?: number;
  working_class?: number;
  new_irish?: number;
  small_business?: number;
  retirees?: number;
  young_urban?: number;
  border_communities?: number;
}

/**
 * IE domain affinities: how each IE archetype reacts to RIGHTWARD policy shifts.
 * Positive = likes rightward (more market, more traditional-conservative).
 * Negative = likes leftward (more state, more liberalizing).
 *
 * Anchors derived from spec §7 of 2026-05-27-ie-legislation-overhaul-design.md.
 */
export const IE_DOMAIN_AFFINITIES: Record<PolicyDomain, IEArchetypeApprovalTemplate> = {
  // Placeholders — no archetype-approval data designed for these domains yet;
  // fill in to enable approval previews for them.
  agriculture: {},
  technology: {},
  // EDUCATION: private schools / vouchers vs public investment
  education: {
    urban_professional: 10,
    rural_traditional: 15,
    working_class: -30,
    new_irish: -20,
    small_business: 20,
    retirees: 5,
    young_urban: -25,
    border_communities: -10,
  },

  // HEALTHCARE: private insurance / hybrid vs Sláintecare universal
  healthcare: {
    urban_professional: 10,
    rural_traditional: -20,
    working_class: -35,
    new_irish: -30,
    small_business: 20,
    retirees: -40,
    young_urban: -30,
    border_communities: -25,
  },

  // ENVIRONMENT: soften targets vs decarbonisation acceleration
  environment: {
    urban_professional: -25,
    rural_traditional: 30,
    working_class: 10,
    new_irish: -10,
    small_business: 25,
    retirees: 0,
    young_urban: -45,
    border_communities: 15,
  },

  // IMMIGRATION: restrict vs liberalize
  immigration: {
    urban_professional: -10,
    rural_traditional: 25,
    working_class: 5,
    new_irish: -45,
    small_business: -10,
    retirees: 15,
    young_urban: -25,
    border_communities: 20,
  },

  // CRIMINAL JUSTICE: tougher policing/sentencing vs reform
  criminal_justice: {
    urban_professional: 10,
    rural_traditional: 25,
    working_class: 5,
    new_irish: -15,
    small_business: 20,
    retirees: 30,
    young_urban: -25,
    border_communities: 10,
  },

  // DEFENSE: expanded mission / EU CSDP / NATO vs neutrality preservation
  defense: {
    urban_professional: 15,
    rural_traditional: -15,
    working_class: -25,
    new_irish: 0,
    small_business: 10,
    retirees: -15,
    young_urban: -10,
    border_communities: -30,
  },

  // ECONOMIC: market liberalization vs state-led / industrial policy
  economic: {
    urban_professional: 25,
    rural_traditional: 10,
    working_class: -30,
    new_irish: -10,
    small_business: 30,
    retirees: 0,
    young_urban: -20,
    border_communities: -15,
  },

  // WELFARE: cuts vs expansion
  welfare: {
    urban_professional: 15,
    rural_traditional: -15,
    working_class: -35,
    new_irish: -30,
    small_business: 20,
    retirees: -40,
    young_urban: -25,
    border_communities: -20,
  },

  // INFRASTRUCTURE: privatisation / toll-roads vs state public investment
  infrastructure: {
    urban_professional: -10,
    rural_traditional: -20,
    working_class: -25,
    new_irish: -15,
    small_business: 10,
    retirees: -15,
    young_urban: -30,
    border_communities: -30,
  },

  // GOVERNANCE: centralisation vs devolution / reform
  governance: {
    urban_professional: 5,
    rural_traditional: 10,
    working_class: -15,
    new_irish: -20,
    small_business: 5,
    retirees: 15,
    young_urban: -30,
    border_communities: -25,
  },

  // FOREIGN POLICY: realist / transactional vs multilateralist / aid-focused
  foreign_policy: {
    urban_professional: -15,
    rural_traditional: 10,
    working_class: -10,
    new_irish: -25,
    small_business: 15,
    retirees: 0,
    young_urban: -25,
    border_communities: -15,
  },

  // TAX: cuts vs redistribution / raises
  tax: {
    urban_professional: 20,
    rural_traditional: 15,
    working_class: -30,
    new_irish: -15,
    small_business: 35,
    retirees: -10,
    young_urban: -20,
    border_communities: -15,
  },

  // MEDIA / INFORMATION: restrict / RTÉ reform vs press freedom / public-broadcasting
  mediaInformation: {
    urban_professional: -5,
    rural_traditional: 15,
    working_class: -10,
    new_irish: -10,
    small_business: 15,
    retirees: -25,
    young_urban: -15,
    border_communities: 0,
  },
};

/**
 * Calculate archetype approval impacts based on policy shift.
 *
 * @param policyDomain - The policy domain (e.g., "education", "healthcare")
 * @param oldIndex - Previous policy option index (0-6, lower = more left)
 * @param newIndex - New policy option index (0-6, lower = more left)
 * @param billCountry - Optional country ID; pass "UK" for UK-specific archetypes
 * @returns Record of archetype ID → approval change
 */
export function calculateShiftImpacts(
  policyDomain: string,
  oldIndex: number,
  newIndex: number,
  billCountry?: string,
  /**
   * Per-option combined position score (`economic + social`), indexed like the
   * options array. When supplied, the shift DIRECTION and extremeness are derived
   * from these curated scores (negative = left, positive = right) instead of the
   * array index. This is the SSOT for left-right and is robust to option ordering:
   * tax brackets (and some CN/DE/JP types) are authored right→left (index 0 = the
   * most market-friendly option), so the bare index runs opposite the affinity
   * convention and flips every approval sign. Falls back to index-based direction
   * when omitted (legacy callers / options without position scores).
   */
  optionScores?: number[]
): Record<string, number> {
  const domain = getDomainForPolicyDomain(policyDomain);
  // Select country-specific affinity table, falling back to US archetypes
  const countryAffinities = billCountry
    ? {
        UK: UK_DOMAIN_AFFINITIES,
        JP: JP_DOMAIN_AFFINITIES,
        DE: DE_DOMAIN_AFFINITIES,
        CN: CN_DOMAIN_AFFINITIES,
        IE: IE_DOMAIN_AFFINITIES,
      }[billCountry]
    : undefined;
  const affinities = (countryAffinities?.[domain] ?? DOMAIN_AFFINITIES[domain]) as
    Record<string, number | undefined> | undefined;

  // Defensive: if a PolicyDomain is ever missing from both the country table and
  // the US fallback (e.g. a domain added to the type but not yet to every table),
  // treat it as "no archetype impacts" instead of crashing the Propose modal /
  // turn enactment on Object.entries(undefined).
  if (!affinities) return {};

  // Direction + extremeness. Prefer the curated position scores (robust to option
  // ordering); fall back to the array index when scores aren't supplied.
  const useScores =
    optionScores !== undefined &&
    Number.isFinite(optionScores[oldIndex]) &&
    Number.isFinite(optionScores[newIndex]);

  let shift: number;
  let positionMultiplier: number;
  if (useScores) {
    // shift > 0 = rightward (higher position score = more right).
    shift = optionScores![newIndex] - optionScores![oldIndex];
    // |score| 0 (center) → 0.5×; 5 (single-axis extreme) → 1.5×; clamp for "both"-axis types.
    positionMultiplier = Math.max(0.5, Math.min(1.5, 0.5 + Math.abs(optionScores![newIndex]) / 5));
  } else {
    // Legacy: shift > 0 means rightward movement by array index.
    shift = newIndex - oldIndex;
    const positionMultipliers = [1.5, 1.25, 1.0, 0.5, 1.0, 1.25, 1.5];
    positionMultiplier = positionMultipliers[newIndex] ?? 1.0;
  }
  if (shift === 0) return {};

  const impacts: Record<string, number> = {};

  for (const [archetypeId, affinity] of Object.entries(affinities)) {
    if (affinity === undefined || affinity === 0) continue;

    // Impact = shift direction × affinity × scale × position multiplier
    // If shift is +2 (rightward) and affinity is +30 (likes right), impact is positive
    // If shift is +2 (rightward) and affinity is -30 (likes left), impact is negative
    const rawImpact = shift * affinity * SHIFT_IMPACT_SCALE * positionMultiplier;
    const clampedImpact = Math.max(-10, Math.min(10, Math.round(rawImpact)));

    if (clampedImpact !== 0) {
      impacts[archetypeId] = clampedImpact;
    }
  }

  return impacts;
}
