import { ALL_CRISIS_TEMPLATES } from "./templates";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import type { CountryId } from "@/lib/constants/countries";

export function getNaturalDisasterTemplateKeys(): string[] {
  return Object.entries(ALL_CRISIS_TEMPLATES)
    .filter(([, t]) => (t as CrisisTemplate).naturalDisaster === true)
    .map(([key]) => key);
}

/** Country gating for a disaster template: allow-list (if set) minus deny-list. */
export function isDisasterAllowedInCountry(
  template: CrisisTemplate,
  countryId: CountryId
): boolean {
  const geo = template.geo;
  if (!geo) return true;
  if (geo.countries && !geo.countries.includes(countryId)) return false;
  if (geo.excludeCountries && geo.excludeCountries.includes(countryId)) return false;
  return true;
}

/** Disaster templates whose country gating admits `countryId`. */
export function disasterTemplatesForCountry(
  countryId: CountryId
): Array<{ key: string; template: CrisisTemplate }> {
  return getNaturalDisasterTemplateKeys()
    .map((key) => ({ key, template: ALL_CRISIS_TEMPLATES[key] as CrisisTemplate }))
    .filter(({ template }) => isDisasterAllowedInCountry(template, countryId));
}

/** Deterministic pick from the full eligible set; `seed` is any non-negative integer.
 *  Retained for callers/tests that don't need geo gating. */
export function selectDisasterTemplate(seed: number): {
  key: string;
  template: CrisisTemplate;
} {
  const keys = getNaturalDisasterTemplateKeys();
  const key = keys[Math.abs(Math.trunc(seed)) % keys.length];
  return { key, template: ALL_CRISIS_TEMPLATES[key] as CrisisTemplate };
}
