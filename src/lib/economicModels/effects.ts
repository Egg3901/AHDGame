import { MODEL_ARCHETYPES, type EconomicModelState } from "@/lib/constants/economicModels";

/**
 * Economic-model EFFECT helpers (P7b). Every effect is scaled by `I = intensity/100`
 * and is PARITY-NEUTRAL when the model is absent, "mixed", or I = 0 — so the
 * golden-master GDP/corp/metric tests stay byte-identical and only model-present
 * behavior changes. Callers pass the LAGGED (previous-turn) `economicModel` per the
 * §7 lagged-edge rule.
 */

/**
 * Effect ACTIVATION (binary). A held NAMED model applies its effects at FULL strength
 * the moment it's active — intensity is a fit/confidence readout, not an effect dial.
 * Returns 1 for any active named model (incl. low-intensity seeded ones), 0 when the
 * model is absent or "mixed" (the structureless residual). This `s` replaces the old
 * `I` scalar in every effect helper, so each effect is full when active and
 * parity-neutral (golden-master-safe) only when no named model is held.
 */
export function effectStrength(model?: EconomicModelState): number {
  if (!model) return 0;
  return MODEL_ARCHETYPES[model.current]?.primarySector ? 1 : 0;
}

/**
 * §7.1 diminishing-returns term on the concentration / spending-efficiency boosts.
 * Activation is now binary (`effectStrength` ∈ {0,1}), so this no longer damps an
 * intensity→effect→intensity spiral (there is none — the boost is constant once
 * active). At full strength `saturation(1) = 0.5` simply sets the full-strength
 * magnitude: a primary GDP-weight boost of 0.5·0.5 = +25%, not the raw +50%.
 */
export const CONCENTRATION_DIMINISH = 0.5;
export function saturation(I: number): number {
  return Math.max(0, 1 - CONCENTRATION_DIMINISH * I);
}

/**
 * §6.1 sector GDP concentration — the multiplier on an aligned sector's WEIGHT in
 * the revenue-weighted growth average. At full strength: primary ×(1 + 0.5·sat) =
 * +25%, secondary ×(1 + 0.2·sat) = +10%, everything else ×1. Reweights a rate
 * (mints no output); it moves aggregate growth only when sector rates differ — the
 * intended specialization fragility.
 */
export function concentrationMultiplier(
  model: EconomicModelState | undefined,
  sectorType: string | undefined
): number {
  const s = effectStrength(model);
  if (!model || s <= 0 || !sectorType) return 1;
  const archetype = MODEL_ARCHETYPES[model.current];
  const sat = saturation(s);
  if (sectorType === archetype.primarySector) return 1 + 0.5 * s * sat;
  if ((archetype.secondarySectors as string[]).includes(sectorType)) return 1 + 0.2 * s * sat;
  return 1; // off-model — concentration only boosts aligned sectors
}

/**
 * §6.2 corp alignment margin deltas (operating-margin FRACTION at full strength).
 * Shared by the applied effect (below) and the presenter, so the displayed numbers
 * can't drift from what's actually applied. Primary rewarded most, secondaries less,
 * off-model mildly penalized.
 */
export const CORP_MARGIN_PRIMARY = 0.08;
export const CORP_MARGIN_SECONDARY = 0.03;
export const CORP_MARGIN_OFF_MODEL = -0.02;

/**
 * §6.2 corp alignment margin modifier — a SIGNED operating-margin delta (fraction)
 * applied per corporation by its sector's alignment to the country's model:
 * primary +0.08, secondary +0.03, off-model −0.02 (at full strength). 0 when the
 * model is absent or "mixed". Building into the national identity is rewarded;
 * building against it is mildly penalized.
 */
export function corpAlignmentModifier(
  model: EconomicModelState | undefined,
  sectorType: string | undefined
): number {
  const s = effectStrength(model);
  if (!model || s <= 0 || !sectorType) return 0;
  const archetype = MODEL_ARCHETYPES[model.current];
  if (sectorType === archetype.primarySector) return CORP_MARGIN_PRIMARY * s;
  if ((archetype.secondarySectors as string[]).includes(sectorType))
    return CORP_MARGIN_SECONDARY * s;
  return CORP_MARGIN_OFF_MODEL * s; // off-model penalty
}

/**
 * §6.3 metric synergies — per-metric signed target nudges (full `maxNudge` while
 * active) a held model applies to its synergy metrics. Empty when the model is
 * absent or "mixed". Keyed by bare metricId; the engine resolves the node and adds
 * the nudge to that node's TARGET (smoothed through coexistence, not hard-set).
 */
export function synergyNudges(model: EconomicModelState | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const s = effectStrength(model);
  if (!model || s <= 0) return out;
  for (const syn of MODEL_ARCHETYPES[model.current].metricSynergies) {
    out.set(syn.metricId, syn.maxNudge * s);
  }
  return out;
}

/**
 * §6.4 spending efficiency — the multiplier on per-capita spend in the model's
 * SIGNATURE categories: ×(1 + 0.25·sat) = +12.5% at full strength. Coherent spending
 * (matching the economic identity) goes further. 1 for off-signature categories and
 * when the model is absent / "mixed".
 */
export function spendingEfficiencyMultiplier(
  model: EconomicModelState | undefined,
  category: string | undefined
): number {
  const s = effectStrength(model);
  if (!model || s <= 0 || !category) return 1;
  const sig = MODEL_ARCHETYPES[model.current].spendingSignature[category] ?? 0;
  return sig > 0 ? 1 + 0.25 * s * saturation(s) : 1;
}

/** Apply the §6.4 efficiency multiplier to a per-capita spend map (new object). */
export function applySpendingEfficiency(
  spending: Record<string, number>,
  model: EconomicModelState | undefined
): Record<string, number> {
  if (effectStrength(model) <= 0) return spending; // parity fast-path (no named model)
  const out: Record<string, number> = {};
  for (const [cat, v] of Object.entries(spending))
    out[cat] = v * spendingEfficiencyMultiplier(model, cat);
  return out;
}

/** Alignment label for the corp badge. */
export function corpAlignmentLabel(
  model: EconomicModelState | undefined,
  sectorType: string | undefined
): "favored" | "disfavored" | "neutral" {
  if (!model || effectStrength(model) <= 0 || !sectorType) return "neutral";
  const archetype = MODEL_ARCHETYPES[model.current];
  if (
    sectorType === archetype.primarySector ||
    (archetype.secondarySectors as string[]).includes(sectorType)
  ) {
    return "favored";
  }
  return "disfavored";
}
