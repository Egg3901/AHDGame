/**
 * Nationalization subsystem tunables (spec Appendix B). All balance values live
 * here so they can be retuned without touching logic. Durations are in TURNS
 * (24 turns/day) per project convention — never wall-clock.
 */

/** Compensation tier applied to the valuation. */
export type CompensationTier = "fair" | "discounted" | "seizure";

/** Authority path that authorized a taking. */
export type NationalizationPath = "executive" | "legislative" | "supermajority";

/** Multiplier on valuation per compensation tier (the relative tier ladder). */
export const TIER_MULTIPLIER: Record<CompensationTier, number> = {
  fair: 1.0,
  discounted: 0.5, // DISCOUNT_TIER_FRACTION
  seizure: 0, // token min; shareholders get nothing
};

/**
 * Buyout premium paid above the bare valuation on every compensated taking — a
 * forced acquisition costs the state well over the going-concern NPV, the way a
 * real takeover pays a premium over market. Scales the whole tier ladder, so at
 * 5× a fair-value taking pays 5× NPV and a discounted emergency taking pays 2.5×;
 * a seizure still pays nothing. This makes nationalization a serious fiscal
 * commitment rather than a bargain. Tunable.
 */
export const NATIONALIZATION_COMPENSATION_PREMIUM = 5;

/**
 * Buyout premium used INSTEAD of {@link NATIONALIZATION_COMPENSATION_PREMIUM}
 * when the market tier is >= "plants" (D11 — exits settle at book).
 *
 * Under plants a sector's compensation base changes from a capitalized earnings
 * stream (going-concern NPV) to the replacement-cost BOOK of its built
 * capacity. Those are different quantities with very different magnitudes, so
 * carrying the 5× earnings-premium across would price a taking off a number it
 * was never calibrated against.
 *
 * SET TO 1.0 — compensation is book, with NO premium. This was 1.5 (replacement
 * cost plus half again "for taking it against the owner's will"), and that is a
 * MINT. `capitalStock` under plants is depreciated by the turn processor, but a
 * sector built THIS turn has taken no depreciation yet, so its book is exactly
 * what the owner just paid to build it. A 1.5 premium therefore makes
 * build-then-get-nationalized pay 1.5× cost with certainty: a player who can
 * provoke a taking (or a state whose NatCorp policy is predictable) prints 50%
 * on every unit of capacity they put in the ground, funded by the treasury. No
 * amount of political cost on the taking side fixes that, because the mint
 * accrues to the party being taken FROM.
 *
 * At 1.0 a taking is value-neutral for the owner at the balance-sheet level:
 * they hand over plant and receive exactly what the plant is worth on the books.
 * Nationalization stays a serious fiscal commitment (the treasury pays full
 * replacement cost, in cash, at once) without being an arbitrage. It also stays
 * strictly above the dissolution salvage fraction (< 1), so a targeted corp
 * still prefers being nationalized to liquidating itself — the ordering the 1.5
 * was reached for is preserved at 1.0.
 *
 * TODO(plants, capacity age): a genuine fairness premium is defensible ONLY
 * against capacity the owner has actually held and depreciated — pay above book
 * for an old, written-down plant with productive life left, and at (or below)
 * book for capacity commissioned days ago. That needs per-unit capacity age
 * tracking on the sector (a build cohort/vintage on `capitalStock`, not the
 * single scalar it is today). When that lands, this constant can become an
 * age-scaled function rather than a flat multiplier. Until then, flat 1.0 is the
 * only setting that cannot be farmed.
 *
 * Moves nationalization AND privatization together — `privatizeAsset` prices the
 * reverse trade off this same constant on purpose, so the round trip
 * (nationalize then re-privatize) is a wash rather than a spread to harvest.
 * Tunable.
 */
export const NATIONALIZATION_BOOK_PREMIUM = 1.0;

/** Market-share fraction at/above which a corp is monopoly-eligible (P4 trigger). */
export const MONOPOLY_SHARE_THRESHOLD = 0.75;

/** Cap on how many sector types a country may hold designated strategic at once. */
export const MAX_STRATEGIC_SECTOR_DESIGNATIONS = 5;

/** Vote fraction for the supermajority override (P4). */
export const SUPERMAJORITY_THRESHOLD = 2 / 3;

/** Turns a CEO seat must be vacant before the distress trigger fires. */
export const DISTRESS_VACANT_CEO_TURNS = 72;

/**
 * Turns a player corp must remain in FINANCIAL distress (insolvency or a
 * defaulted bond) before it becomes executively-nationalizable. Matches the
 * CEO-vacancy threshold so all distress triggers share one runway. NPC/unowned
 * corps have no grace. Spec: executive-taking distress grace period.
 */
export const FINANCIAL_DISTRESS_GRACE_TURNS = 72;

// ── Transition shock (operational cost of a taking) ─────────────────────────

/** One-time fraction deleted from a nationalized chunk's revenue at transfer. */
export const NATIONALIZATION_REVENUE_HAIRCUT = 0.15;

/** Peak transition output drag on a freshly nationalized sector (decays to 0). */
export const NATIONALIZATION_PRODUCTIVITY_HIT = 0.15;

/**
 * Hard ceiling on the (SOCI-deepened) transition output hit — the factor never
 * drops below `1 - NATIONALIZATION_MAX_TRANSITION_HIT`, so even a huge empire's
 * fresh taking loses at most this fraction of output transiently, and always
 * recovers to full. Tunable.
 */
export const NATIONALIZATION_MAX_TRANSITION_HIT = 0.5;

/** Turns over which the productivity drag linearly recovers to normal. */
export const NATIONALIZATION_TRANSITION_TURNS = 120;

/** NPV discount rate for sector valuation — matches the existing corp NPV rate. */
export const NPV_ANNUAL_DISCOUNT_RATE = 0.25;

// ── SOE operations (Phase 2, spec §11) ──────────────────────────────────────

/** Dynamic-efficiency base penalty (pp), replacing the old flat −15. Spec §11.3. */
/**
 * Base state-owned-enterprise efficiency penalty.
 *
 * Softened from -10 to -6. SOEs seed at a 12 profit margin, so a -10 penalty
 * left just 2pp of headroom before any other modifier — and in a command economy
 * EVERY producing sector is an SOE, so the whole economy started 2pp from
 * insolvency. Measured at -10.14pp average it was the second-largest drag on the
 * 1000-turn run. -6 still makes state ownership meaningfully less efficient than
 * private operation without pricing it below viability on day one.
 */
export const BASE_SOE_PENALTY = -6;

/** Efficiency clamp (pp). A well-run SOE approaches MIN; a corrupt one MAX. */
export const SOE_PENALTY_MIN = -5; // least drag (best case)
export const SOE_PENALTY_MAX = -25; // most drag (worst case)

/** Corruption coefficient: at corruptionIndex=100, adds this many pp of drag. */
export const SOE_CORRUPTION_COEFF = -10;

/** Governance coefficient: at governmentTransparency=100, removes this many pp of drag. */
export const SOE_GOVERNANCE_COEFF = 7;

/** Extra margin drag (pp) while a sector's mandate is price-controlled. */
export const SOE_PRICE_CONTROL_PENALTY = -6;

/**
 * Extra margin drag (pp) while a sector's mandate guarantees employment — the
 * SOE acts as employer of last resort and carries excess payroll. Lighter than
 * the price-control penalty: employment relief lifts a single metric
 * (unemployment), whereas price control multiplies the sector's whole public-
 * value contribution. Makes the posture a real profit-vs-relief trade-off rather
 * than a free boost.
 */
export const SOE_EMPLOYMENT_GUARANTEE_PENALTY = -4;

/**
 * Steady-state "overreach" drag (pp at full escalation): a sprawling state
 * sector is somewhat less efficient (coordination failure, soft budget
 * constraints, political interference). Applied as `SOE_OVERREACH_COEFF ×
 * (sociMultiplier − 1)`, so it is 0 below the danger zone and grows moderately
 * with concentration. The existing [-25,-5] clamp is unchanged, so this never
 * loss-locks a well-run SOE — it only thins profit. Tunable.
 */
export const SOE_OVERREACH_COEFF = -3;

/** Multiplier on a sector's mandate metric contribution while price-controlled. */
export const SOE_PRICE_CONTROL_BONUS_MULTIPLIER = 1.5;

/**
 * Per-turn metric contribution at full SOE dominance (soeShareOfStateSector=1),
 * before per-metric coefficients. Small by design: the slow policy decay
 * (0.25%/turn) amplifies a sustained per-turn nudge into a durable plateau, so
 * keep this tiny. Tunable.
 */
export const SOE_MANDATE_CONTRIBUTION_AT_FULL_SHARE = 0.03;

/** Hard cap on how far one SOE sector may push a single metric above its current value (pp). */
export const SOE_MANDATE_PER_METRIC_CAP = 8;

// ── Politics, consequences & investor confidence (Phase 3a, spec §12) ────────

/** Investor-confidence index baseline (heal target). 0–100. Spec §12.4. */
export const INVESTOR_CONFIDENCE_BASELINE = 70;

/** Per-turn fraction of the gap to baseline that heals back each turn. */
export const CONFIDENCE_RECOVERY_PER_TURN = 0.05;

/**
 * Base investor-confidence points removed for the ACT of expropriating a private
 * owner — fires regardless of how well the taking is paid (a forced taking of a
 * going concern unsettles investors even at fair value). Scaled by the SOCI
 * escalation multiplier, ideology, and a popularity factor. Tunable.
 */
export const CONFIDENCE_BASE_EXPROPRIATION_HIT = 8;

/**
 * Extra confidence points removed for UNDERPAYING — the old compensation
 * softener, scoped to its proper role. Scaled by tier weight × the unpaid
 * fraction (a fully-paid taking zeroes this; a seizure pays it in full). Tunable.
 */
export const CONFIDENCE_SEIZURE_SURCHARGE = 12;

/**
 * Multiplier on the BASE hit for a popular taking (distress rescue / monopoly
 * break-up) — these poll well, so the act scars confidence less. Unpopular
 * takings use 1.0. Tunable.
 */
export const CONFIDENCE_POPULAR_HIT_FACTOR = 0.25;

/** Tier weight on the confidence hit (fair barely moves it; seizure full). */
export const CONFIDENCE_TIER_WEIGHT: Record<"fair" | "discounted" | "seizure", number> = {
  fair: 0.1,
  discounted: 0.55,
  seizure: 1.0,
};

/**
 * Tier weight on the POLITICAL cost (approval + legitimacy). Flatter than the
 * confidence weight because political backlash is driven by the ACT of seizing
 * a firm, not by how generously it was paid — a fair-paid taking still angers
 * the public and erodes legitimacy (half weight), and underpaying only amplifies
 * it (seizure full). Decoupled from CONFIDENCE_TIER_WEIGHT so a fair taking is
 * not politically near-free. Tunable.
 */
export const POLITICAL_TIER_WEIGHT: Record<"fair" | "discounted" | "seizure", number> = {
  fair: 0.5,
  discounted: 0.75,
  seizure: 1.0,
};

/** Legitimacy points removed for a full seizure (confidence-model countries). */
export const LEGITIMACY_HIT_BASE = 6;

/** Generic public-trust metric nudge (pp) for an unpopular taking, full-seizure scale. */
export const APPROVAL_PUBLIC_TRUST_HIT = 4;

/** Public-trust metric nudge (pp) for a popular taking (distress rescue / monopoly break-up). */
export const APPROVAL_PUBLIC_TRUST_BOOST = 3;

/** Ideology multiplier bounds on the legitimacy/confidence/approval hit. */
export const IDEOLOGY_MULTIPLIER_MIN = 0.5; // statist govt — cheaper
export const IDEOLOGY_MULTIPLIER_MAX = 1.5; // market-liberal govt — costlier

// ── Investor-confidence feeds (spec §12.4) ───────────────────────────────────

/** Feed 1: max private-corp margin drag (pp) at confidence 0. SOEs exempt. */
export const EXPROPRIATION_RISK_MARGIN_MAX = -6;

/** Feed 2: max sovereign interest-rate premium (decimal, e.g. 0.03 = +3pp) at confidence 0. */
export const SOVEREIGN_CONFIDENCE_PREMIUM_MAX = 0.03;

/** Feed 3: max founding-cost multiplier surcharge at confidence 0 (1.0 = no effect at baseline). */
export const FOUNDING_CONFIDENCE_PENALTY_MAX = 0.25; // up to +25% founding cost

// ── State Ownership Concentration Index (SOCI) — rebalance 2026-06-24 ─────────

/**
 * SOCI (0–100) at/below which there is NO escalation — the multiplier is exactly
 * 1.0. Below the danger zone, nationalization behaves as it does today. Tunable.
 */
export const SOCI_DANGER_ZONE = 35;

/**
 * Escalation multiplier as SOCI → 100. The shared `concentrationMultiplier`
 * ramps convexly from 1.0 at the danger zone to this value at full state
 * ownership, so early takings barely escalate and empire-building bites hard.
 * Tunable.
 */
export const CONCENTRATION_MULTIPLIER_MAX = 3.5;

// ── Counterplay: notice window (Phase 4b, spec §14) ─────────────────────────

/** Notice turns before a distress seizure completes — 0 (abandoned firms seized at once). */
export const DISTRESS_NOTICE_TURNS = 0;

/** Notice turns before a strategic/monopoly (or bare full-reach) player taking completes. */
export const STRATEGIC_NOTICE_TURNS = 48;

// ── Privatization (Phase 5, spec §13 + Appendix B) ───────────────────────────

/** Turns after a privatization before the spun-out corp may be re-nationalized. */
export const RENATIONALIZE_COOLDOWN_TURNS = 168;

/** Turns after a sector is absorbed by nationalization before it may be privatized. */
export const REPRIVATIZE_COOLDOWN_TURNS = 168;

/** Cap on the state-retained golden-share fraction of a spun-out corp (0–1). */
export const GOLDEN_SHARE_MAX = 0.4;

/** Smallest privatization carve-out fraction of a single sector holding. */
export const CARVE_FRACTION_MIN = 0.1;

/**
 * Absolute ceiling on the carve fraction of a single sector holding — a spin-out
 * can take at most 100% of what the National Corporation holds in that sector.
 * The real anti-monopoly limit is {@link PRIVATIZE_MARKET_CONTROL_CAP}, applied
 * to the resulting corp's share of the whole regional market (not of the holding).
 */
export const CARVE_FRACTION_MAX = 1;

/**
 * Anti-monopoly cap (spec §13.1): a single privatization spin-out may not end up
 * controlling more than 30% of the whole (state, sectorType) market. Because a
 * carved corp's market share = carveFraction × the NatCorp's current share of
 * that market, a small holding (≤30% of the market) can be spun out in full,
 * while dominating a market forces several separate spin-outs.
 */
export const PRIVATIZE_MARKET_CONTROL_CAP = 0.3;

/**
 * Largest carve fraction of a holding whose current market share is
 * `marketSharePercent` (0–100) that keeps the new corp at/under the
 * market-control cap. Returns 1 (full carve) when the holding is small.
 */
export function maxCarveFractionForMarketShare(marketSharePercent: number): number {
  if (!(marketSharePercent > 0)) return CARVE_FRACTION_MAX;
  const allowed = (PRIVATIZE_MARKET_CONTROL_CAP * 100) / marketSharePercent;
  return Math.min(CARVE_FRACTION_MAX, allowed);
}

/** Bid-window length (turns) for a privatization auction. */
export const AUCTION_WINDOW_TURNS = 48;

// ── Privatization consequences (Phase 6a, spec §12.1) ────────────────────────

/** Investor-confidence points ADDED when a privatization completes (pro-market signal). */
export const PRIVATIZATION_CONFIDENCE_BOOST_BASE = 5;

/** Public-trust nudge (pp) at full ideology lean; market govt +, statist govt − (spec §12.1). */
export const PRIVATIZATION_APPROVAL_NUDGE = 3;

/** Legitimacy nudge (pp) at full ideology lean (confidence-model countries); market +, statist −. */
export const PRIVATIZATION_LEGITIMACY_NUDGE = 3;

// ── CEO operations (Phase 6g, spec 2026-06-03) ───────────────────────────────

/** Hard floor on the budget remittance share of a NatCorp's profit (⇒ retention ≤ 75). */
export const MIN_PROFIT_REMITTANCE_PERCENT = 25;

/** Max CEO-set profit retention (= 100 − MIN_PROFIT_REMITTANCE_PERCENT). */
export const MAX_PROFIT_RETENTION_PERCENT = 100 - MIN_PROFIT_REMITTANCE_PERCENT;

/** Default per-turn treasury-draw cap (local currency) until a minister sets one. */
export const DEFAULT_TREASURY_DRAW_CAP = 10_000_000;

// ── NatCorp modernization (R&D) — decaying, scale-aware momentum ──────────────
// A National Corporation's `rdScore` is a *momentum* on the 0–MAX innovation
// scale (MAX = the innovation threshold, so breakthrough chance = score / MAX).
// Each turn it tracks a funding-driven target and bleeds toward 0 at a flat
// rate when underfunded — so sustained, scale-proportional funding is required
// to hold a high modernization, and a giant corp can no longer max it for a
// pittance. Private-corp R&D is unaffected (only NatCorps run this step).

/**
 * Ceiling for NatCorp modernization momentum (= innovation threshold ⇒ 100%
 * chance). Inlined (not imported from `@/lib/constants/corporations`) because
 * that module imports THIS one — a top-level cross-import would dead-zone. A
 * test asserts it equals `RD_INNOVATION_SCORE_THRESHOLD`.
 */
export const NATCORP_RD_MOMENTUM_MAX = 200;

/**
 * Per-turn R&D spend that sustains the MAXIMUM modernization, as a fraction of
 * the corp's per-turn sector revenue. Spending this fraction ⇒ full intensity
 * (target = MAX). Half of it ⇒ half intensity (target = MAX/2). 0.03 = 3% —
 * affordable alongside growth/production funding (max R&D ≈ a sixth of profit
 * at a typical margin), not the prohibitive ~half-of-profit a 10% bar implied.
 */
export const NATCORP_RD_FULL_FUND_REVENUE_FRACTION = 0.03;

/**
 * Flat per-turn decay when momentum is above its funded target — independent of
 * the current level, so full modernization (MAX) lapses to 0 over exactly one
 * year (48 = TURNS_PER_YEAR) without funding.
 */
export const NATCORP_RD_DECAY_PER_TURN = NATCORP_RD_MOMENTUM_MAX / 48;

/** Max per-turn rise toward the funded target (full intensity climbs MAX→0 in 8 turns). */
export const NATCORP_RD_RAMP_UP_PER_TURN = NATCORP_RD_MOMENTUM_MAX / 8;
