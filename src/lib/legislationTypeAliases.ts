import type { LegislationType } from "@/lib/db/types";

const LEGACY_TO_CANONICAL: Record<string, string> = {
  us_federal_corporate_tax_rate: "us_federal_domestic_corporate_tax_rate",
  us_state_corporate_tax_rate: "us_state_domestic_corporate_tax_rate",
  uk_corporation_tax: "uk_domestic_corporation_tax",
  jp_corporation_tax: "jp_domestic_corporation_tax",
  de_corporate_tax_rate: "de_domestic_corporate_tax_rate",
};

const CANONICAL_TO_LEGACY = Object.entries(LEGACY_TO_CANONICAL).reduce<Record<string, string[]>>(
  (acc, [legacyId, canonicalId]) => {
    acc[canonicalId] ??= [];
    acc[canonicalId].push(legacyId);
    return acc;
  },
  {}
);

export function canonicalizeLegislationTypeId(id?: string | null): string | null {
  if (!id) return null;
  return LEGACY_TO_CANONICAL[id] ?? id;
}

export function getEquivalentLegislationTypeIds(id?: string | null): string[] {
  const canonicalId = canonicalizeLegislationTypeId(id);
  if (!canonicalId) return [];
  return [
    ...new Set(
      [canonicalId, ...(CANONICAL_TO_LEGACY[canonicalId] ?? []), id].filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    ),
  ];
}

export function getLegislationTypeById<T extends Pick<LegislationType, "_id">>(
  legislationTypeMap: Map<string, T>,
  id?: string | null
): T | undefined {
  for (const candidateId of getEquivalentLegislationTypeIds(id)) {
    const legislationType = legislationTypeMap.get(candidateId);
    if (legislationType) return legislationType;
  }
  return undefined;
}

export function humanizeLegislationTypeId(id?: string | null): string | null {
  const canonicalId = canonicalizeLegislationTypeId(id);
  if (!canonicalId) return null;

  return canonicalId
    .replace(/^[a-z]{2}_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
