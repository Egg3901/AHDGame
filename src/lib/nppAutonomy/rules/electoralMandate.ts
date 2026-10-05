/**
 * Electoral mandate: what the governing party ran on, as bounded domain
 * emphasis for the governing agenda (#2321).
 *
 * `computeGoverningAgenda` already accepts a `mandate` map (domain to signed
 * emphasis in [-1, 1]); this rule produces it. Two sources, both owned by the
 * party rather than by the sitting head of government:
 *
 *   - **Locked manifesto pledges** (countries with a manifesto system). Each
 *     pledge names a concrete domain the party promised to act on.
 *   - **The party platform** (every country). The party's own economic and
 *     social positions, as voters saw them at the election.
 *
 * Both are scaled by mandate strength, which grows with the governing party's
 * share of the elected chamber: a landslide carries a firmer mandate than a
 * narrow minority. The head-of-government's personal ideology is a separate
 * agenda input, so two governments led by identical heads still diverge when
 * their parties won on opposing platforms.
 *
 * Pure: no database, clock, randomness or environment.
 */

/** Signed domain emphasis in [-1, 1], keyed by the agenda's domain vocabulary. */
export type MandateDomains = Record<string, number>;

export interface MandatePledge {
  /** Catalog id, e.g. "uk.nhs.protect". */
  id: string;
  /** The catalog entry's policy domain, used when the id has no explicit mapping. */
  policyDomain: string;
}

export interface ElectoralMandateInputs {
  /** Governing party platform on the shared -5..+5 axes; null when unknown. */
  platform: { economic: number; social: number } | null;
  /** Pledges from the governing party's most recent locked manifesto. */
  pledges: readonly MandatePledge[];
  /**
   * Governing party share of the elected chamber in [0, 1]. Null when the
   * executive is directly elected or the chamber is unknown.
   */
  seatShare: number | null;
}

export interface ElectoralMandate {
  domains: MandateDomains;
  /** Mandate strength in [MIN_MANDATE_STRENGTH, 1] applied to every domain. */
  strength: number;
}

/** Party positions live on roughly -5..+5. */
const POLICY_SCALE = 5;

/** Weight of the platform channel relative to a single pledge. */
const PLATFORM_MANDATE_WEIGHT = 0.6;
/** Weight of one manifesto pledge. Three pledges can saturate a domain. */
const PLEDGE_MANDATE_WEIGHT = 0.8;

/** Seat share at which the mandate strength starts to rise above the floor. */
const MANDATE_SHARE_FLOOR = 0.2;
/** Seat share span from the floor to a full-strength mandate (0.55 share). */
const MANDATE_SHARE_SPAN = 0.35;
/** A party that formed a government always carries some mandate. */
export const MIN_MANDATE_STRENGTH = 0.25;
/** Strength for a directly elected executive with no chamber share available. */
export const DIRECT_EXECUTIVE_MANDATE_STRENGTH = 0.6;

/** Entries below this magnitude are dropped as noise. */
const MIN_DOMAIN_EMPHASIS = 0.01;

/**
 * Platform-to-domain emphasis. An interventionist platform promises welfare
 * domains; a market platform promises growth and jobs and carries a smaller
 * mandate to shrink welfare spending. The fiscal domain is owned by the fiscal
 * stance and is deliberately absent, as in the agenda itself.
 */
const LEFT_PLATFORM: MandateDomains = {
  poverty: 1.0,
  income_inequality: 1.0,
  healthcare: 0.8,
  education: 0.6,
};
const RIGHT_PLATFORM: MandateDomains = {
  economic_growth: 1.0,
  employment: 0.7,
  poverty: -0.5,
  income_inequality: -0.5,
};
const PROGRESSIVE_PLATFORM: MandateDomains = { social_mobility: 0.5, environment: 0.5 };
const TRADITIONAL_PLATFORM: MandateDomains = { public_safety: 0.5 };

/** Explicit pledge mappings, for pledges whose policy domain is too broad. */
const PLEDGE_DOMAINS: Record<string, MandateDomains> = {
  "uk.nhs.universal": { healthcare: 1.0 },
  "uk.nhs.protect": { healthcare: 0.7 },
  "uk.tax.cutIncome": { economic_growth: 0.7, income_inequality: -0.3 },
  "uk.economy.workerProtections": { employment: 0.5, income_inequality: 0.7 },
  "uk.education.secondaryForAll": { education: 1.0 },
  "uk.economy.industrialModernization": { infrastructure: 0.6, economic_growth: 0.5 },
  "uk.economy.soundMoney": { economic_growth: 0.4, poverty: -0.3 },
};

/** Fallback by catalog policy domain for pledges without an explicit mapping. */
const POLICY_DOMAIN_FALLBACK: Record<string, MandateDomains> = {
  health: { healthcare: 0.8 },
  healthcare: { healthcare: 0.8 },
  education: { education: 0.8 },
  economy: { economic_growth: 0.6 },
  infrastructure: { infrastructure: 0.8 },
  environment: { environment: 0.8 },
  welfare: { poverty: 0.8 },
  crime: { public_safety: 0.8 },
  justice: { public_safety: 0.8 },
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Mandate strength from the governing party's share of the elected chamber. */
export function mandateStrength(seatShare: number | null): number {
  if (seatShare === null || !Number.isFinite(seatShare)) return DIRECT_EXECUTIVE_MANDATE_STRENGTH;
  const share = clamp(seatShare, 0, 1);
  return clamp((share - MANDATE_SHARE_FLOOR) / MANDATE_SHARE_SPAN, MIN_MANDATE_STRENGTH, 1);
}

function add(into: MandateDomains, from: MandateDomains, scale: number): void {
  if (scale === 0) return;
  for (const [domain, weight] of Object.entries(from)) {
    into[domain] = (into[domain] ?? 0) + weight * scale;
  }
}

/** Derive the bounded domain mandate a governing party won on. */
export function deriveElectoralMandate(inputs: ElectoralMandateInputs): ElectoralMandate {
  const strength = mandateStrength(inputs.seatShare);
  const raw: MandateDomains = {};

  if (inputs.platform) {
    const econ = clamp(finite(inputs.platform.economic) / POLICY_SCALE, -1, 1);
    const social = clamp(finite(inputs.platform.social) / POLICY_SCALE, -1, 1);
    add(raw, econ < 0 ? LEFT_PLATFORM : RIGHT_PLATFORM, Math.abs(econ) * PLATFORM_MANDATE_WEIGHT);
    add(
      raw,
      social < 0 ? PROGRESSIVE_PLATFORM : TRADITIONAL_PLATFORM,
      Math.abs(social) * PLATFORM_MANDATE_WEIGHT
    );
  }

  const seen = new Set<string>();
  for (const pledge of inputs.pledges) {
    if (seen.has(pledge.id)) continue;
    seen.add(pledge.id);
    const mapping = PLEDGE_DOMAINS[pledge.id] ?? POLICY_DOMAIN_FALLBACK[pledge.policyDomain];
    if (mapping) add(raw, mapping, PLEDGE_MANDATE_WEIGHT);
  }

  const domains: MandateDomains = {};
  for (const domain of Object.keys(raw).sort()) {
    const value = Math.round(clamp(raw[domain] * strength, -1, 1) * 1000) / 1000;
    if (Math.abs(value) >= MIN_DOMAIN_EMPHASIS) domains[domain] = value;
  }
  return { domains, strength };
}
