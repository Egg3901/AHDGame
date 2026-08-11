import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_ERA1991_PATCHES } from "@/lib/states/conditions/countryEra1991Patches";
import { COUNTRY_MODIFIER_PATCHES } from "@/lib/states/conditions/countryPatches";
import { ERA1991_MODIFIER_PATCHES } from "@/lib/states/conditions/era1991Patches";
import { resolveConditionPreset, type ConditionPreset } from "@/lib/states/conditions/preset";

export interface ModifierDefLike {
  id: string;
  label: string;
  effect: number;
  conditions: import("@/lib/utils/approvalModifiers").Condition[];
  marginFactor?: number;
}

export interface ResolveModifierContext {
  preset?: string | null;
  countryId?: string | null;
}

function applyPatch<T extends ModifierDefLike>(
  def: T,
  patch?: { suppress?: boolean; conditions?: T["conditions"]; marginFactor?: number }
): T | null {
  if (!patch) return def;
  if (patch.suppress) return null;
  return {
    ...def,
    ...(patch.conditions ? { conditions: patch.conditions } : {}),
    ...(patch.marginFactor != null ? { marginFactor: patch.marginFactor } : {}),
  };
}

/** Apply era + country patches to a modifier definition. */
export function resolveModifierDef<T extends ModifierDefLike>(
  def: T,
  ctx?: ResolveModifierContext
): T | null {
  const profile: ConditionPreset = resolveConditionPreset(ctx?.preset);
  let resolved: T | null = def;

  if (profile === "era1991") {
    resolved = applyPatch(resolved, ERA1991_MODIFIER_PATCHES[def.id]);
    if (!resolved) return null;
  }

  const country = ctx?.countryId as CountryId | undefined;
  if (country && COUNTRY_MODIFIER_PATCHES[country]?.[def.id]) {
    resolved = applyPatch(resolved, COUNTRY_MODIFIER_PATCHES[country]![def.id]);
    if (!resolved) return null;
  }

  if (profile === "era1991" && country && COUNTRY_ERA1991_PATCHES[country]?.[def.id]) {
    resolved = applyPatch(resolved, COUNTRY_ERA1991_PATCHES[country]![def.id]);
    if (!resolved) return null;
  }

  return resolved;
}
