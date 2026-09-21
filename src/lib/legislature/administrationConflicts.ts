import type { LegislationType } from "@/lib/db/types/legislation";

export interface AdministrationConflict {
  proposedLegislationTypeId: string;
  existingLegislationTypeId: string;
  conflictSetId: string;
}

export interface AdministrationReplacement {
  proposedLegislationTypeId: string;
  existingLegislationTypeId: string;
  policyFamilyId: string;
}

function conflictSetIds(type: Pick<LegislationType, "administration">): Set<string> {
  return new Set(type.administration?.conflictSetIds ?? []);
}

/**
 * Resolve concrete regime conflicts. Ideological stance is intentionally not
 * an input. A shared family is a replacement; a shared conflict-set id across
 * different families requires the existing regime to be repealed first.
 */
export function resolveAdministrationConflicts(input: {
  proposed: Array<Pick<LegislationType, "_id" | "administration">>;
  existing: Array<Pick<LegislationType, "_id" | "administration">>;
}): {
  conflicts: AdministrationConflict[];
  replacements: AdministrationReplacement[];
} {
  const conflicts: AdministrationConflict[] = [];
  const replacements: AdministrationReplacement[] = [];
  const seenConflicts = new Set<string>();
  const seenReplacements = new Set<string>();

  const compare = (
    proposed: Pick<LegislationType, "_id" | "administration">,
    existing: Pick<LegislationType, "_id" | "administration">
  ) => {
    if (proposed._id === existing._id) return;
    const proposedFamily = proposed.administration?.policyFamilyId;
    const existingFamily = existing.administration?.policyFamilyId;
    if (proposedFamily && existingFamily && proposedFamily === existingFamily) {
      const key = `${proposed._id}:${existing._id}:${proposedFamily}`;
      if (!seenReplacements.has(key)) {
        seenReplacements.add(key);
        replacements.push({
          proposedLegislationTypeId: proposed._id,
          existingLegislationTypeId: existing._id,
          policyFamilyId: proposedFamily,
        });
      }
      return;
    }
    const existingSets = conflictSetIds(existing);
    for (const conflictSetId of conflictSetIds(proposed)) {
      if (!existingSets.has(conflictSetId)) continue;
      const key = `${proposed._id}:${existing._id}:${conflictSetId}`;
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      conflicts.push({
        proposedLegislationTypeId: proposed._id,
        existingLegislationTypeId: existing._id,
        conflictSetId,
      });
    }
  };

  for (const proposed of input.proposed) {
    for (const existing of input.existing) compare(proposed, existing);
  }
  for (let left = 0; left < input.proposed.length; left += 1) {
    for (let right = left + 1; right < input.proposed.length; right += 1) {
      compare(input.proposed[left]!, input.proposed[right]!);
      compare(input.proposed[right]!, input.proposed[left]!);
    }
  }
  return { conflicts, replacements };
}
