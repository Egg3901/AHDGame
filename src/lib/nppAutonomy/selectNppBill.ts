/**
 * selectNppBill — pure, deterministic bill-type selection for autonomous NPP sponsorship (SP2).
 *
 * Given a candidate set of legislation types, the NPP's policy positions, and the
 * current country macro/metric conditions, picks the best legislation type and a
 * matching policy option. No random: tie-break by _id string comparison.
 */

import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "./governingAgenda";
import {
  NPP_SPONSOR_PLATFORM_WEIGHT,
  NPP_SPONSOR_URGENCY_WEIGHT,
  NPP_SPONSOR_AGENDA_WEIGHT,
  NPP_SPONSOR_FISCAL_WEIGHT,
} from "./constants";

// ── Urgency signal: macro + metrics → domain urgency map ──────────────────────

/**
 * Domains that fiscal-tightening legislation belongs to. When inflation is hot,
 * legislation in these domains is urgent (positive direction to tighten).
 */
const FISCAL_TIGHTENING_DOMAINS = new Set([
  "fiscal",
  "fiscal_policy",
  "taxation",
  // The pipeline's actual tax policyDomain (CATEGORY_TO_POLICY_DOMAINS.tax and
  // every projected political tax slider) — the canonical fiscal lever; its
  // absence left tax bills outside the fiscal-stance steer.
  "tax",
  "budget",
  "spending",
  "monetary",
  "debt",
]);

/**
 * Metric → agenda-domain vocabulary, keyed `[category][metricId]`. A metric
 * below 40 (0–100 scale) triggers urgency in its mapped domain. Exported so the
 * governing brain (ministerial governance, agenda) maps cabinet/position metrics
 * to the same domain set the agenda and bill selection speak.
 */
export const METRIC_TO_DOMAIN: Record<string, Record<string, string>> = {
  economic: {
    unemploymentRate: "employment",
    gdpGrowth: "economic_growth",
    medianIncome: "income_inequality",
    povertyRate: "poverty",
    smallBusinessFormation: "economic_growth",
  },
  education: {
    testPerformance: "education",
    educationSpending: "education",
    literacyRate: "education",
    workforceSkill: "workforce",
  },
  healthcare: {
    healthcareAccess: "healthcare",
    infantMortality: "healthcare",
    lifeExpectancy: "healthcare",
  },
  infrastructure: {
    transportQuality: "infrastructure",
    energyAccess: "infrastructure",
  },
  publicSafety: {
    crimeRate: "public_safety",
    policePresence: "public_safety",
  },
  environment: {
    airQuality: "environment",
    carbonEmissions: "environment",
  },
  social: {
    socialMobility: "social_mobility",
    trustInstitutions: "governance",
  },
  governance: {
    corruptionIndex: "governance",
    ruleOfLaw: "governance",
  },
};

/** Metric value (0-100) below which a domain reads as weak (urgency to raise). */
const WEAK_METRIC_THRESHOLD = 40;
/**
 * Metric value (0-100) at/above which a domain reads as comfortably strong -
 * urgency to *lower* (ease off, the domain has room to give something back).
 * The 40-75 band is deliberately inert: "fine, leave it" takes no position.
 */
const STRONG_METRIC_THRESHOLD = 75;

export interface ConditionsSignal {
  /** Inflation rate (%). High inflation → fiscal tightening urgency. */
  inflationRate?: number;
  /** Threshold above which inflation is considered "hot" (default 4.0%). */
  inflationHotThreshold?: number;
  /**
   * Weak metrics by domain: domain string → urgency score in [0, 1].
   * A domain mapped here gets urgency proportional to its score.
   */
  weakDomains?: Record<string, number>;
  /**
   * Comfortably-strong metrics by domain: domain string → comfort score in
   * [0, 1]. A domain mapped here has room to ease off - it feeds the
   * governing agenda's "lower" direction the mirror way weakDomains feeds
   * "raise" (see `computeGoverningAgenda`).
   */
  strongDomains?: Record<string, number>;
}

/**
 * Build a ConditionsSignal from a raw stateMetrics doc and the inflation rate
 * from the federal budget. Exported so the phase can call this once per country.
 */
export function buildConditionsSignal(params: {
  inflationRate: number | undefined;
  /** Raw stateMetrics document (national-scope doc). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stateMetrics: Record<string, any> | null | undefined;
}): ConditionsSignal {
  const inflationRate = params.inflationRate;
  const weakDomains: Record<string, number> = {};
  const strongDomains: Record<string, number> = {};

  const metrics = params.stateMetrics ?? {};
  for (const [category, metricMap] of Object.entries(METRIC_TO_DOMAIN)) {
    const categoryDoc = metrics[category] ?? {};
    for (const [metricId, domain] of Object.entries(metricMap)) {
      const mv = categoryDoc[metricId];
      if (mv == null) continue;
      // Support StateMetricValue shape {value} or a raw number
      const raw = typeof mv === "object" && "value" in mv ? mv.value : mv;
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      // Treat low values as weak. Use linear scale to derive urgency.
      if (raw < WEAK_METRIC_THRESHOLD) {
        const urgency = Math.max(0, (WEAK_METRIC_THRESHOLD - raw) / WEAK_METRIC_THRESHOLD); // 0..1
        const existing = weakDomains[domain] ?? 0;
        if (urgency > existing) weakDomains[domain] = urgency;
      } else if (raw >= STRONG_METRIC_THRESHOLD) {
        const comfort = Math.min(
          1,
          (raw - STRONG_METRIC_THRESHOLD) / (100 - STRONG_METRIC_THRESHOLD)
        );
        const existing = strongDomains[domain] ?? 0;
        if (comfort > existing) strongDomains[domain] = comfort;
      }
    }
  }

  return { inflationRate, weakDomains, strongDomains };
}

// ── Platform fit ──────────────────────────────────────────────────────────────

/**
 * Score how well a legislation type + policy option vector aligns with the
 * NPP's own policy positions. Returns a value in [0, 1], 1 = the option sits
 * exactly on the NPP's ideological point, 0 = as far as the -5..5 plane allows.
 *
 * This is a magnitude-aware nearest-point match (Euclidean distance on the
 * shared economic/social -5..5 plane), not a direction-only projection. A
 * prior direction-only formula normalized away the option's magnitude
 * (dividing by hypot(option.economic, option.social)), so every option
 * sharing the NPP's sign on a domain scored *identically* regardless of how
 * extreme it was — and whenever the NPP had no lean at all on a ladder's
 * active axis (economic:0 is the norm for e.g. every US defense option; only
 * social varies), *all* options tied. The deterministic first-wins tie-break
 * in bestPlatformFit/bestFitAmong then always picked whichever option was
 * seeded earliest in policyOptions — which for domain ladders ordered
 * weakest-to-strongest is the "abolish it" extreme. That is the mechanism
 * behind the incident where a near-neutral (economic:0.1, social:0) US NPP
 * autonomously repealed the Armed Forces Establishment Act and the Defense
 * Production and Research Act for "Skeleton Force" / "No Defense Industry
 * Policy" — both $0-cost options — deleting roughly a third of the federal
 * budget within about a year of the 1953 start (see selectNppBill.defenseGutting.test.ts).
 *
 * Distance-based matching fixes this without foreclosing genuine
 * demilitarization/deregulation ("gravity, not rails"): an NPP whose own
 * position is itself near a ladder's extreme still matches that extreme
 * option best; a neutral or weakly-leaning NPP is pulled toward the ladder's
 * moderate/status-quo option instead of an array-order accident.
 */
function platformFitForOption(npp: NPP, option: LegislationPolicyOption): number {
  const economic = npp.policies?.economic ?? 0;
  const social = npp.policies?.social ?? 0;

  const distance = Math.hypot(economic - option.economic, social - option.social);
  // Both axes are conventionally -5..5 (see LegislationPolicyOption docs), so
  // the two furthest points on the plane are 10 apart per axis.
  const maxDistance = 10 * Math.SQRT2;
  return Math.max(0, 1 - distance / maxDistance);
}

/**
 * Best platform-fit score across all policy options in a legislation type.
 * Also returns the best-fit option (for use in the bill provision).
 */
function bestPlatformFit(
  npp: NPP,
  legType: LegislationType
): { score: number; option: LegislationPolicyOption | null } {
  const options = legType.policyOptions ?? [];
  if (options.length === 0) return { score: 0.5, option: null };

  let bestScore = -Infinity;
  let bestOpt: LegislationPolicyOption | null = null;
  for (const opt of options) {
    const score = platformFitForOption(npp, opt);
    if (score > bestScore) {
      bestScore = score;
      bestOpt = opt;
    }
  }
  return { score: bestScore, option: bestOpt };
}

// ── Urgency fit ───────────────────────────────────────────────────────────────

/**
 * Compute an urgency score for a legislation type given the country conditions.
 * Returns [0, 1].
 *
 * - If inflation is hot and the legislation type domain is in FISCAL_TIGHTENING_DOMAINS,
 *   urgency is proportional to how much inflation exceeds the threshold.
 * - If the legislation type's domain appears in weakDomains, the urgency is that score.
 */
function urgencyForType(legType: LegislationType, signal: ConditionsSignal): number {
  const domain = legType.policyDomain?.toLowerCase() ?? "";
  const inflationRate = signal.inflationRate ?? 0;
  const threshold = signal.inflationHotThreshold ?? 4.0;
  const weakDomains = signal.weakDomains ?? {};

  let urgency = 0;

  // Fiscal-tightening domains are urgent when inflation is hot
  if (FISCAL_TIGHTENING_DOMAINS.has(domain) && inflationRate > threshold) {
    const gap = inflationRate - threshold;
    // Up to 10% above threshold → urgency 1.0; linear ramp
    urgency = Math.max(urgency, Math.min(1, gap / 10));
  }

  // Metric-based domain urgency
  const domainUrgency = weakDomains[domain] ?? 0;
  urgency = Math.max(urgency, domainUrgency);

  return urgency;
}

/**
 * Pick the policy option whose effectDirection best matches the urgency sign.
 * - For fiscal-tightening urgency (positive): prefer effectDirection = +1 (tighten)
 * - For metric weakness (need improvement): prefer effectDirection = +1 (increase metric)
 * - If no urgency, defer to the platform-fit best option.
 *
 * Falls back to the highest platform-fit option when no directional match exists.
 */
function urgencyDirectedOption(
  npp: NPP,
  legType: LegislationType,
  signal: ConditionsSignal
): LegislationPolicyOption | null {
  const options = legType.policyOptions ?? [];
  if (options.length === 0) return null;

  const inflationRate = signal.inflationRate ?? 0;
  const threshold = signal.inflationHotThreshold ?? 4.0;
  const domain = legType.policyDomain?.toLowerCase() ?? "";
  const weakDomains = signal.weakDomains ?? {};

  // Determine preferred direction based on urgency type
  let preferredDirection: number | null = null;
  if (FISCAL_TIGHTENING_DOMAINS.has(domain) && inflationRate > threshold) {
    // High inflation → tighten (positive direction in fiscal domain)
    preferredDirection = 1;
  } else if (weakDomains[domain] && weakDomains[domain] > 0) {
    // Weak metric → want to increase (effectDirection = 1 = more of this metric)
    preferredDirection = 1;
  }

  if (preferredDirection !== null) {
    const directed = options.filter((o) => o.effectDirection === preferredDirection);
    if (directed.length > 0) {
      // Among directed options, pick best platform fit; tie-break by id
      let best: LegislationPolicyOption | null = null;
      let bestScore = -Infinity;
      for (const opt of directed) {
        const score = platformFitForOption(npp, opt);
        if (score > bestScore || (score === bestScore && best && opt.id < best.id)) {
          bestScore = score;
          best = opt;
        }
      }
      return best;
    }
  }

  // Fallback: best platform-fit option
  return bestPlatformFit(npp, legType).option;
}

// ── Agenda bias (V1.5) ────────────────────────────────────────────────────────

/**
 * The governing agenda item (if any) a legislation type advances. A type
 * advances an agenda item when its `policyDomain` matches the item's domain and
 * the item is not "hold". Returns the highest-priority such item (the agenda is
 * already ranked, so this is the most important thing the type can advance).
 */
function agendaItemForType(
  legType: LegislationType,
  agenda: GoverningAgendaItem[] | undefined
): GoverningAgendaItem | null {
  if (!agenda || agenda.length === 0) return null;
  const domain = legType.policyDomain?.toLowerCase() ?? "";
  if (!domain) return null;
  let best: GoverningAgendaItem | null = null;
  for (const item of agenda) {
    if (item.direction === "hold") continue;
    if (item.domain.toLowerCase() !== domain) continue;
    if (!best || item.priority > best.priority) best = item;
  }
  return best;
}

/** Best platform-fit option among a directed subset; deterministic id tie-break. */
function bestFitAmong(
  npp: NPP,
  options: LegislationPolicyOption[]
): LegislationPolicyOption | null {
  let best: LegislationPolicyOption | null = null;
  let bestScore = -Infinity;
  for (const opt of options) {
    const score = platformFitForOption(npp, opt);
    if (score > bestScore || (score === bestScore && best && opt.id < best.id)) {
      bestScore = score;
      best = opt;
    }
  }
  return best;
}

/**
 * Pick the option that best serves the agenda item's direction (raise → increase
 * the metric, effectDirection +1; lower → decrease, -1), falling back to the
 * conditions-directed option when no directional match exists.
 */
function agendaDirectedOption(
  npp: NPP,
  legType: LegislationType,
  signal: ConditionsSignal,
  agendaItem: GoverningAgendaItem | null
): LegislationPolicyOption | null {
  if (agendaItem) {
    const preferred = agendaItem.direction === "raise" ? 1 : -1;
    const directed = (legType.policyOptions ?? []).filter((o) => o.effectDirection === preferred);
    const pick = bestFitAmong(npp, directed);
    if (pick) return pick;
  }
  return urgencyDirectedOption(npp, legType, signal);
}

// ── Fiscal restraint on cost-bearing ladders (domain-agnostic) ───────────────

/**
 * An option's comparable annual cost, whichever cost field the type authors
 * with (spending ladders carry `gdpCostFraction`/`annualCostPerCapita`; some
 * carry `gdpPerCapitaMultiplier`). Options with none of these (structural/
 * governance bills, tax-rate ladders keyed on `rate` instead) read 0.
 */
const COST_FIELDS = ["gdpCostFraction", "annualCostPerCapita", "gdpPerCapitaMultiplier"] as const;

/**
 * Pick ONE cost field for the whole ladder (the first of the preference order
 * any option authors), so ranking never compares incompatible units - a
 * 0.02 gdpCostFraction sorted against a 500 annualCostPerCapita is
 * meaningless. Options missing the ladder's chosen field read 0.
 */
function ladderCostField(options: LegislationPolicyOption[]): (typeof COST_FIELDS)[number] | null {
  for (const field of COST_FIELDS) {
    if (options.some((o) => typeof o[field] === "number")) return field;
  }
  return null;
}

function relativeCost(
  option: LegislationPolicyOption,
  field: (typeof COST_FIELDS)[number]
): number {
  const value = option[field];
  return typeof value === "number" ? value : 0;
}

/**
 * Fiscal-restraint pick for cost-bearing category ladders (health, defense,
 * education, infrastructure, welfare, …) - the spending-shaped legislation
 * that actually drives these countries' budgets but sits outside
 * `FISCAL_TIGHTENING_DOMAINS` (that set only covers the fiscal/tax/budget
 * domain strings, not per-category policyDomains). Without this, an austere
 * fiscal stance had literally no lever on the ladders that mattered: the
 * governing agenda's "raise" pull (a weak metric wants more spending) always
 * won by default, with nothing on the other side ever pulling back - the
 * mechanism behind the measured debt ratchet (ahd_sim_g53v4: YU/HU/PL/BG/RO
 * all read "expansionary" at 93-115% debt/GDP because their dominant cost
 * driver - health/defense ladders - never consulted the fiscal stance at
 * all).
 *
 * Domain-agnostic by design: it keys off each option's own cost field, not
 * `policyDomain` or `effectDirection` (whose sign convention differs by
 * ladder shape - a tax ladder's "cut" and a spending ladder's "cut" don't
 * share a sign), so it reaches any cost-bearing ladder without needing a
 * per-domain allowlist that goes stale as new legislation is authored.
 *
 * "Gravity, not rails": returns null (no restraint) for ladders with no real
 * cost spread - including the pre-existing `armedForcesLadder` regression
 * fixture, which carries no cost fields at all - and otherwise pulls
 * proportionally FROM the ladder's own middle rung TOWARD its cheapest rung
 * as `intensity` climbs, rather than snapping straight to the floor: a
 * barely-austere government (intensity just past the 0.25 stance threshold)
 * barely moves off center, a severely-distressed one (intensity 1) reaches
 * the cheapest option.
 */
export interface FiscalRestraintPick {
  option: LegislationPolicyOption | null;
  /**
   * True when restraint applies to this ladder (real cost spread, austere
   * stance) but the enacted rung is already at or below the desired one.
   * "Restraint" must never RAISE spending: without the enacted-rung ceiling, a
   * barely-austere government already sitting on its cheapest rung would get a
   * bill moving it back up toward the middle. On hold, the caller skips the
   * ladder entirely - falling through to the agenda would let its "raise" pull
   * re-ratchet the exact spending the stance exists to pull back.
   */
  hold: boolean;
}

function fiscalRestraintOption(
  options: LegislationPolicyOption[],
  intensity: number,
  enactedOptionId?: string
): FiscalRestraintPick {
  if (options.length < 2) return { option: null, hold: false };
  const field = ladderCostField(options);
  if (!field) return { option: null, hold: false };
  const ranked = [...options].sort((a, b) => relativeCost(a, field) - relativeCost(b, field));
  const cheapest = relativeCost(ranked[0], field);
  const priciest = relativeCost(ranked[ranked.length - 1], field);
  if (!(priciest > cheapest)) return { option: null, hold: false }; // no real cost spread - not a spending ladder

  const centerIdx = (ranked.length - 1) / 2;
  const idx = Math.round(centerIdx * (1 - Math.max(0, Math.min(1, intensity))));
  const clamped = Math.max(0, Math.min(ranked.length - 1, idx));

  // Ceiling at the enacted rung: only ever move DOWN the cost ladder. When
  // the enacted rung is unknown (no statePolicies row yet), keep the plain
  // interpolated pick - there is nothing to compare against.
  const enactedIdx = enactedOptionId ? ranked.findIndex((o) => o.id === enactedOptionId) : -1;
  if (enactedIdx >= 0 && clamped >= enactedIdx) return { option: null, hold: true };
  return { option: ranked[clamped], hold: false };
}

// ── Top-level selector ────────────────────────────────────────────────────────

export interface NppBillSelection {
  legType: LegislationType;
  option: LegislationPolicyOption;
  score: number;
  /**
   * Tax-slider laws (ruling #16, no options ladder): the direction the NPC
   * wants the rate moved (+1 hike, −1 cut). The propose command resolves the
   * concrete rate against the live budget (`taxSliderNotchRate`); `option` is
   * a synthetic scoring stand-in, not a real ladder option.
   */
  taxSliderDirection?: -1 | 1;
}

/**
 * The direction an NPC wants a tax slider moved: the government's fiscal
 * stance for fiscal bills when one is active (tighten = hike), otherwise the
 * NPC's economic lean (left hikes, right cuts). Null = no move wanted.
 */
function taxSliderDirectionFor(
  npp: NPP,
  fiscalStance: { direction: -1 | 0 | 1; intensity: number } | undefined,
  isFiscalBill: boolean
): -1 | 1 | null {
  if (fiscalStance && fiscalStance.direction !== 0 && isFiscalBill) {
    return fiscalStance.direction;
  }
  const economic = npp.policies?.economic ?? 0;
  if (economic > 0) return -1;
  if (economic < 0) return 1;
  return null;
}

/**
 * Select the best legislation type + policy option for an autonomous NPP to sponsor.
 *
 * Pure, deterministic, no DB access. Returns null if no suitable candidate is found.
 *
 * @param candidates - National-scope legislation types with policyOptions.
 * @param npp - The NPP that will sponsor the bill (for platform-fit scoring).
 * @param signal - Current-conditions urgency signal for the country.
 * @param agenda - Optional governing agenda (V1.5) to bias selection toward.
 * @param fiscalStance - Optional government fiscal posture (V1.6) biasing tax/spending bills.
 */
export function selectNppBill(
  candidates: LegislationType[],
  npp: NPP,
  signal: ConditionsSignal,
  agenda?: GoverningAgendaItem[],
  fiscalStance?: { direction: -1 | 0 | 1; intensity: number },
  /**
   * Currently enacted policy option per legislation type id (the country's
   * national statePolicies rows). Lets the fiscal-restraint pick treat the
   * enacted rung as a ceiling instead of choosing an absolute rung blind.
   */
  currentPolicyOptionIds?: ReadonlyMap<string, string>,
  /** Legislation types this sponsor party introduced inside the repeat window. */
  recentLegislationTypeIds?: ReadonlySet<string>
): NppBillSelection | null {
  if (candidates.length === 0) return null;

  const fiscalActive = !!fiscalStance && fiscalStance.direction !== 0;

  let best: NppBillSelection | null = null;

  for (const legType of candidates) {
    if (recentLegislationTypeIds?.has(legType._id)) continue;
    const options = legType.policyOptions ?? [];
    // Tax-slider laws carry no options ladder — synthesize a directional
    // stand-in so NPCs can sponsor rate moves (deferred-item fix).
    const isFiscalForSlider = FISCAL_TIGHTENING_DOMAINS.has(
      legType.policyDomain?.toLowerCase() ?? ""
    );
    const sliderDirection = legType.taxSlider
      ? taxSliderDirectionFor(npp, fiscalStance, isFiscalForSlider)
      : null;
    const sliderPseudoOption: LegislationPolicyOption | null = sliderDirection
      ? {
          id: "slider",
          name: "Rate Adjustment",
          stance: sliderDirection < 0 ? "right" : "left",
          effectDirection: sliderDirection,
          // Moderate force in the NPC's preferred direction: cuts read
          // rightward, hikes leftward (mirrors taxSliderNpcEconomic's sign).
          economic: -sliderDirection * 2.5,
          social: 0,
        }
      : null;
    if (options.length === 0 && !sliderPseudoOption) continue;

    const { score: platScore } = sliderPseudoOption
      ? { score: platformFitForOption(npp, sliderPseudoOption) }
      : bestPlatformFit(npp, legType);
    const urgScore = urgencyForType(legType, signal);
    // Agenda bias (V1.5): 0 when no agenda is supplied, so non-governing/v0
    // sponsorship scores exactly as before.
    const agendaItem = agendaItemForType(legType, agenda);
    const agendaScore = agendaItem?.priority ?? 0;
    // Fiscal-posture bias (V1.6): only for tax/spending bills, only when the
    // government holds a non-neutral stance.
    const isFiscalBill = FISCAL_TIGHTENING_DOMAINS.has(legType.policyDomain?.toLowerCase() ?? "");
    const fiscalScore = fiscalActive && isFiscalBill ? fiscalStance!.intensity : 0;
    const combined =
      NPP_SPONSOR_PLATFORM_WEIGHT * platScore +
      NPP_SPONSOR_URGENCY_WEIGHT * urgScore +
      NPP_SPONSOR_AGENDA_WEIGHT * agendaScore +
      NPP_SPONSOR_FISCAL_WEIGHT * fiscalScore;

    if (
      best === null ||
      combined > best.score ||
      (combined === best.score && legType._id < best.legType._id)
    ) {
      // Slider laws carry the synthetic stand-in + direction; the propose
      // command resolves the concrete rate against the live budget.
      if (sliderPseudoOption && sliderDirection) {
        best = {
          legType,
          option: sliderPseudoOption,
          score: combined,
          taxSliderDirection: sliderDirection,
        };
        continue;
      }
      // Fiscal posture directs tax/spending options; otherwise the agenda does.
      let option: LegislationPolicyOption | null = null;
      if (fiscalActive && isFiscalBill) {
        const directed = options.filter((o) => o.effectDirection === fiscalStance!.direction);
        option = bestFitAmong(npp, directed);
      }
      // Fiscal restraint (domain-agnostic): an austere stance pulls any
      // cost-bearing ladder toward its cheaper rungs even when its
      // policyDomain isn't one of the fiscal/tax/budget strings above - this
      // is what lets debt distress actually reach health/defense/education/
      // infrastructure spending instead of only tax bills.
      // direction === 1 is the "austere/tighten" convention (see
      // PersistedFiscalStance.direction) - the narrower inline type this
      // function accepts doesn't carry `stance`, so key off direction instead.
      //
      // Crisis standdown: an active emergency on this domain outranks debt
      // distress (governingAgenda's stated contract - "a real emergency still
      // wins even under maximum debt distress"), so restraint yields to the
      // agenda's crisis item instead of starving the crisis domain.
      if (!option && fiscalActive && fiscalStance!.direction === 1 && !agendaItem?.crisis) {
        const restraint = fiscalRestraintOption(
          options,
          fiscalStance!.intensity,
          currentPolicyOptionIds?.get(legType._id)
        );
        // Already at/below the desired rung: no bill on this ladder at all -
        // see FiscalRestraintPick.hold for why the agenda must not run here.
        if (restraint.hold) continue;
        option = restraint.option;
      }
      if (!option) option = agendaDirectedOption(npp, legType, signal, agendaItem);
      if (!option) continue;
      best = { legType, option, score: combined };
    }
  }

  return best;
}
