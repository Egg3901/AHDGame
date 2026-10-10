/** Population-weighted named conditions reconcile to the damped regional aggregate. */
import { POSITIVE_MODIFIER_NET_CAP, type ActiveModifier } from "@/lib/utils/approvalModifiers";

export function regionalModifierBreakdown(
  regions: readonly {
    base: number;
    approval: number;
    population: number;
    modifiers: ActiveModifier[];
  }[]
): ActiveModifier[] {
  const population = regions.reduce((sum, region) => sum + Math.max(0, region.population), 0);
  if (population === 0) return [];
  const byId = new Map<string, ActiveModifier>();
  let base = 0;
  let approval = 0;
  const round = (value: number) => Math.round(value * 10) / 10;
  for (const region of regions) {
    const weight = Math.max(0, region.population) / population;
    base += region.base * weight;
    approval += region.approval * weight;
    const positive = region.modifiers.reduce(
      (sum, modifier) => sum + Math.max(0, modifier.effect),
      0
    );
    const positiveScale =
      positive > 0 ? Math.min(positive, POSITIVE_MODIFIER_NET_CAP) / positive : 1;
    for (const modifier of region.modifiers) {
      const row = byId.get(modifier.id) ?? { ...modifier, effect: 0, marginEffect: 0 };
      row.effect += modifier.effect * (modifier.effect > 0 ? positiveScale : 1) * weight;
      row.marginEffect = 0; // National chips describe approval, not a country's sector margins.
      byId.set(modifier.id, row);
    }
  }
  const result = [...byId.values()]
    .map((modifier) => ({ ...modifier, effect: round(modifier.effect) }))
    .filter((modifier) => modifier.effect !== 0);
  const adjustment = round(
    round(approval) - round(base) - result.reduce((sum, modifier) => sum + modifier.effect, 0)
  );
  if (adjustment !== 0)
    result.push({
      id: "regional_adjustment",
      label: "Regional smoothing and rounding",
      effect: adjustment,
      marginEffect: 0,
      source: "metric",
    });
  return result;
}
