// src/lib/nppAutonomy/governingAgenda.ts
/**
 * The Governing Agenda (V1.2) — the core idea of NPP autonomy.
 *
 * A governing party computes a small, ranked, multi-turn **policy agenda** once
 * per cycle. This single shared object is what converts the scattered reflexes
 * of v0 (a weak NPP sponsoring a bill here, voting there) into a coherent
 * government: bill sponsorship advances the agenda, ministers get allocation
 * targets from it, fiscal stance derives from it.
 *
 * The agenda is a pure function of three inputs, blended by archetype weights:
 *   - **Conditions** - weak national metrics → urgency to *raise* the domain;
 *     comfortably strong metrics → an equally legitimate urgency to *lower* it
 *     (reuse `ConditionsSignal` / `buildConditionsSignal` so the agenda speaks
 *     the same domain vocabulary as `selectNppBill`).
 *   - **Ideology** — the governing party / head-of-gov `policies.economic|social`.
 *     A market-leaning government doesn't just abstain from the welfare-state
 *     domains it doesn't campaign on - it can actively want to shrink them.
 *   - **Mandate** - domains the party emphasised winning the last election. A
 *     negative weight is a mandate to *cut* the domain, not just to skip it.
 *
 * Plus one whole-of-government pressure that recolors the above rather than
 * adding a new domain of its own:
 *   - **Fiscal distress** - severe sovereign-debt distress (same credit-rating
 *     tier `getDebtThreshold` already prices bond yields off) pulls the
 *     government's own *weakly-justified* raise items toward "lower": it
 *     competes as extra "lower" mass on domains the government would otherwise
 *     raise, so a genuinely dire unmet need (high urgency, or an active
 *     crisis) can still out-mass it and keep expanding, while a merely
 *     ideological or mildly-weak raise item flips under real distress. This is
 *     what makes the debt-ratchet symptom self-correcting: previously nothing
 *     fed debt distress back into the SAME domain-level agenda that drives
 *     ministerial spending, only into the separate aggregate fiscal stance.
 *
 * No target band, no mean reversion: every driver above is a mass that
 * competes with every other mass on the same domain (see `addContribution`'s
 * "heavier of raise/lower wins" merge) - direction is a *consequence* of a
 * government's own conditions, ideology, and politics, not a rule that pulls
 * every country toward the same number.
 *
 * Deterministic, total, and side-effect free — the phase layer does the DB I/O
 * and persists the result on `governmentFormation.governingAgenda`.
 */

import type { ConditionsSignal } from "./selectNppBill";
import {
  deriveGoverningArchetype,
  GOVERNING_ARCHETYPE_MODIFIERS,
  GOVERNING_ARCHETYPE_CLAMP,
  type GoverningArchetype,
} from "./governingArchetype";
import type { NPPPersonality } from "@/lib/db/types/npp";
import { getDebtThreshold } from "@/lib/budget/debt";

/** Whether the government wants a domain's metric to move up, down, or hold. */
export type AgendaDirection = "raise" | "lower" | "hold";

export interface GoverningAgendaItem {
  /** Policy domain — same vocabulary as `METRIC_TO_DOMAIN` values in selectNppBill. */
  domain: string;
  /** Aspirational 0–100 health target the government steers the domain toward. */
  target: number;
  direction: AgendaDirection;
  /** Normalised rank weight in [0, 1]; the items always sum-sort descending. */
  priority: number;
  /**
   * True when an active crisis (V1.8) contributed to this item. Consumers that
   * would otherwise override the agenda (the fiscal-restraint pick in
   * selectNppBill) must stand down for crisis items: every government answers
   * an emergency, even under maximum debt distress.
   */
  crisis?: boolean;
}

export interface GoverningAgenda {
  items: GoverningAgendaItem[];
  archetype: GoverningArchetype;
  /** Game turn the agenda was computed — drives the recompute cadence. */
  computedTurn: number;
}

/** Inputs the (DB-reading) phase layer assembles and hands to the pure compute. */
export interface GoverningAgendaInputs {
  conditions: ConditionsSignal;
  /** Governing party / head-of-gov ideology, on the ~-5..+5 economic|social scale. */
  ideology: { economic: number; social: number };
  /** Head-of-government personality → governing archetype (input weighting). */
  personality: NPPPersonality;
  /**
   * Optional electoral mandate: domain → emphasis. Positive in [0, 1] is what
   * the party ran and won on (raise it); negative in [-1, 0) is a mandate to
   * *cut* the domain (e.g. a platform that ran on shrinking it). Absent for
   * governments seated without a clear platform signal.
   */
  mandate?: Record<string, number>;
  /**
   * Active-crisis pressure (V1.8): domain → severity in [0, 1]. Injected as
   * dominant "raise" items so the whole brain (ministerial orders, bill
   * sponsorship) pivots to respond to the emergency. Absent in calm times.
   */
  crises?: Record<string, number>;
  /**
   * Sovereign debt as a fraction of GDP (1.0 = 100%), the same figure
   * `fiscalStance.computeFiscalStance` reads. Optional - omitting it (as the
   * V2.1 caretaker-minister path currently does) simply skips the fiscal-
   * distress driver below; every other input still behaves identically.
   */
  debtToGdpRatio?: number;
  currentTurn: number;
}

/** Base number of agenda items before the archetype breadth delta + clamp. */
const BASE_AGENDA_BREADTH = 4;

/**
 * Crisis contribution multiplier (V1.8). A crisis-affected domain is weighted
 * well above normal conditions/ideology drivers (whose mass is ≲1.4), so an
 * active emergency dominates the agenda and becomes the top-priority item.
 */
const CRISIS_AGENDA_WEIGHT = 2.0;

/** Policy-position scale normaliser (positions live on roughly -5..+5). */
const POLICY_SCALE = 5;

/** Default health target a government steers a "raise" domain toward. */
const DEFAULT_RAISE_TARGET = 65;

/**
 * Default floor a government steers a "lower" domain toward. Deliberately
 * above the 40-point weak line (see `buildConditionsSignal`/
 * `politicalWeakDomains`) so a government trimming a comfortable or
 * ideologically-opposed domain eases spending without autonomously driving it
 * into crisis territory - the mirror image of `DEFAULT_RAISE_TARGET` never
 * overshooting past 65.
 */
const DEFAULT_LOWER_TARGET = 45;

/**
 * How much lower-priority mass a market-leaning government's principled
 * opposition to welfare-state spending contributes, relative to the same
 * domain's own raise-side weight in `LEFT_ECONOMIC_DOMAINS`. Kept well below
 * 1.0 so this is a real but subordinate pull: it can flip a domain the
 * government has no other reason to fund, but a genuinely urgent weak metric
 * (conditions) or the government's own platform (mandate/crisis) can still
 * outweigh pure ideological antipathy. Calibrated so it never crowds the
 * government's own RIGHT_ECONOMIC_DOMAINS priorities (growth, employment) out
 * of a narrow agenda (see governingAgenda.test.ts's breadth-clamp coverage).
 */
const IDEOLOGICAL_CUT_MULT = 0.5;

/**
 * Debt-distress ceiling/weight for the agenda's fiscal-distress driver - reuse
 * of the exact same credit-rating-tier read `fiscalStance.ts` prices the
 * aggregate stance off (see that file's `DEBT_DISTRESS_CEILING`/
 * `DEBT_DISTRESS_WEIGHT` for the full tier-by-tier rationale). Duplicated
 * (not imported) because the two callers round differently: fiscalStance
 * turns it into one aggregate score, this turns it into a per-domain "lower"
 * mass. `DISTRESS_AGENDA_WEIGHT` is capped at `CRISIS_AGENDA_WEIGHT` (2.0) on
 * purpose - at the worst (CCC) tier, fiscal distress is exactly as forceful as
 * an active crisis on any *other* domain, but a crisis on the SAME domain is
 * always added afterward on top of it (see step 5), so a real emergency still
 * wins even under maximum debt distress.
 */
const DEBT_DISTRESS_CEILING = 0.7; // CCC tier's gdpPenalty - normalizes to [0,1]
const DISTRESS_AGENDA_WEIGHT = 2.0;

/**
 * Domains a left-leaning (interventionist, economic < 0) government prioritises,
 * weighted by how strongly it cares. Right-leaning (economic > 0) governments
 * get the mirrored market/growth set.
 *
 * The **fiscal** domain is deliberately absent here. Inflation/debt response is
 * owned end-to-end by the V1.6 fiscal stance (`fiscalStance.ts`), which is the
 * single source of fiscal-domain direction for bill sponsorship — so the agenda
 * never emits a competing fiscal item (no double-count, no contradiction).
 */
const LEFT_ECONOMIC_DOMAINS: Record<string, number> = {
  poverty: 1.0,
  income_inequality: 1.0,
  healthcare: 0.8,
  education: 0.6,
};
const RIGHT_ECONOMIC_DOMAINS: Record<string, number> = {
  economic_growth: 1.0,
  employment: 0.7,
};

/** Normalise a -5..+5 policy position into a signed [-1, 1] strength. */
function normPolicy(v: number): number {
  return Math.max(-1, Math.min(1, v / POLICY_SCALE));
}

/** Internal accumulator while merging candidate contributions by domain. */
interface Candidate {
  domain: string;
  weighted: number; // accumulated priority mass
  // direction mass — the heavier of raise/lower decides the item's direction
  dirMass: { raise: number; lower: number; hold: number };
  /** Target to use if the item resolves to "lower" (e.g. inflation threshold). */
  lowerTarget: number;
  /** Set when step 4 injected active-crisis mass into this domain. */
  crisis?: boolean;
}

function addContribution(
  map: Map<string, Candidate>,
  domain: string,
  mass: number,
  direction: AgendaDirection,
  lowerTarget: number
): void {
  if (mass <= 0) return;
  const existing = map.get(domain);
  if (existing) {
    existing.weighted += mass;
    existing.dirMass[direction] += mass;
    if (direction === "lower") existing.lowerTarget = lowerTarget;
  } else {
    map.set(domain, {
      domain,
      weighted: mass,
      dirMass: { raise: 0, lower: 0, hold: 0, [direction]: mass } as Candidate["dirMass"],
      lowerTarget,
    });
  }
}

/**
 * Compute a governing party's ranked policy agenda. Pure, deterministic, total.
 *
 * The three inputs are blended with archetype weights, merged per-domain, ranked
 * by accumulated priority mass, truncated to the archetype's agenda breadth, and
 * the surviving priorities are renormalised to [0, 1].
 */
export function computeGoverningAgenda(inputs: GoverningAgendaInputs): GoverningAgenda {
  const archetype = deriveGoverningArchetype(inputs.personality);
  const mods = GOVERNING_ARCHETYPE_MODIFIERS[archetype];

  const candidates = new Map<string, Candidate>();

  // 1. Conditions - weak domains drive urgency to *raise* (improve) the domain;
  // comfortably strong domains drive an equally legitimate urgency to *lower*
  // it (the government has room to ease off and isn't obligated to keep
  // pushing a metric that's already fine). Symmetric mechanism, opposite
  // trigger, opposite direction - same conditionsWeightMult archetype color.
  const weak = inputs.conditions.weakDomains ?? {};
  for (const [domain, urgency] of Object.entries(weak)) {
    addContribution(
      candidates,
      domain,
      urgency * mods.conditionsWeightMult,
      "raise",
      DEFAULT_RAISE_TARGET
    );
  }
  const strong = inputs.conditions.strongDomains ?? {};
  for (const [domain, comfort] of Object.entries(strong)) {
    addContribution(
      candidates,
      domain,
      comfort * mods.conditionsWeightMult,
      "lower",
      DEFAULT_LOWER_TARGET
    );
  }

  // (Inflation/fiscal response is owned by the V1.6 fiscal stance — see above.)

  // 2. Ideology — the governing party's economic lean picks a domain set.
  const econ = normPolicy(inputs.ideology.economic);
  const econStrength = Math.abs(econ);
  if (econStrength > 0) {
    const set = econ < 0 ? LEFT_ECONOMIC_DOMAINS : RIGHT_ECONOMIC_DOMAINS;
    for (const [domain, w] of Object.entries(set)) {
      addContribution(
        candidates,
        domain,
        econStrength * w * mods.ideologyWeightMult,
        "raise",
        DEFAULT_RAISE_TARGET
      );
    }
    // A market-leaning government's small-government instinct isn't just
    // silence on the welfare-state domains it doesn't campaign on - it's a
    // real, if subordinate, preference to shrink them. No mirror on the left:
    // LEFT_ECONOMIC_DOMAINS/RIGHT_ECONOMIC_DOMAINS aren't a symmetric pair of
    // "spending I like" vs "spending I dislike" - growth/employment are
    // universally desired, so there's no equivalent domain a left government
    // would principledly want to cut.
    if (econ > 0) {
      for (const [domain, w] of Object.entries(LEFT_ECONOMIC_DOMAINS)) {
        addContribution(
          candidates,
          domain,
          econStrength * w * IDEOLOGICAL_CUT_MULT * mods.ideologyWeightMult,
          "lower",
          DEFAULT_LOWER_TARGET
        );
      }
    }
  }
  // Social lean adds a lighter cohesion emphasis (sign-aware, modest weight).
  const social = normPolicy(inputs.ideology.social);
  const socialStrength = Math.abs(social);
  if (socialStrength > 0) {
    // Progressive (social < 0) → mobility/environment; traditional → public safety.
    const domain = social < 0 ? "social_mobility" : "public_safety";
    addContribution(
      candidates,
      domain,
      socialStrength * 0.5 * mods.ideologyWeightMult,
      "raise",
      DEFAULT_RAISE_TARGET
    );
  }

  // 3. Mandate - what the party won on. A negative weight is a mandate to cut.
  for (const [domain, weight] of Object.entries(inputs.mandate ?? {})) {
    if (weight >= 0) {
      addContribution(
        candidates,
        domain,
        weight * mods.mandateWeightMult,
        "raise",
        DEFAULT_RAISE_TARGET
      );
    } else {
      addContribution(
        candidates,
        domain,
        -weight * mods.mandateWeightMult,
        "lower",
        DEFAULT_LOWER_TARGET
      );
    }
  }

  // 3.5 Fiscal distress - severe sovereign-debt distress (same credit-rating
  // tier fiscalStance prices bond yields off) adds "lower" mass to whatever
  // domains conditions/ideology/mandate above already made raise targets.
  // Only recolors existing candidates - a distressed country with literally no
  // agenda pull yet doesn't spontaneously invent a domain to cut. Crises
  // (added after) are never touched: an emergency is added fresh, on top,
  // always winning over pre-existing distress mass on the same domain.
  if (typeof inputs.debtToGdpRatio === "number") {
    const debtPenalty = getDebtThreshold(inputs.debtToGdpRatio).gdpPenalty;
    if (debtPenalty > 0) {
      const distressMass = (debtPenalty / DEBT_DISTRESS_CEILING) * DISTRESS_AGENDA_WEIGHT;
      for (const existing of [...candidates.values()]) {
        if (existing.dirMass.raise > 0) {
          addContribution(candidates, existing.domain, distressMass, "lower", DEFAULT_LOWER_TARGET);
        }
      }
    }
  }

  // 4. Crises (V1.8) — active emergencies inject dominant "raise" items so the
  // government pivots to restore the damaged domain. Weighted above all normal
  // drivers and not archetype-discounted: every government answers a crisis.
  for (const [domain, severity] of Object.entries(inputs.crises ?? {})) {
    addContribution(
      candidates,
      domain,
      Math.max(0, severity) * CRISIS_AGENDA_WEIGHT,
      "raise",
      DEFAULT_RAISE_TARGET
    );
    const marked = candidates.get(domain);
    if (marked) marked.crisis = true;
  }

  // Rank by accumulated mass, tie-break by domain name for determinism.
  const ranked = [...candidates.values()].sort((a, b) => {
    if (b.weighted !== a.weighted) return b.weighted - a.weighted;
    return a.domain < b.domain ? -1 : 1;
  });

  const breadth = Math.min(
    GOVERNING_ARCHETYPE_CLAMP.maxAgendaBreadth,
    Math.max(
      GOVERNING_ARCHETYPE_CLAMP.minAgendaBreadth,
      BASE_AGENDA_BREADTH + mods.agendaBreadthDelta
    )
  );
  const top = ranked.slice(0, breadth);

  // Renormalise surviving priorities to [0, 1] against the strongest item.
  const maxMass = top.length > 0 ? top[0].weighted : 1;
  const items: GoverningAgendaItem[] = top.map((c) => {
    const direction: AgendaDirection =
      c.dirMass.lower > c.dirMass.raise ? "lower" : c.dirMass.raise > 0 ? "raise" : "hold";
    return {
      domain: c.domain,
      target: direction === "lower" ? c.lowerTarget : DEFAULT_RAISE_TARGET,
      direction,
      priority: maxMass > 0 ? c.weighted / maxMass : 0,
      ...(c.crisis ? { crisis: true } : {}),
    };
  });

  return { items, archetype, computedTurn: inputs.currentTurn };
}
