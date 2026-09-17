import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import type { MacroCountryState } from "./types";

/**
 * Mongo filter fragment matching live macro economies.
 * `{ retiredAt: null }` matches both explicit null and a missing field, so
 * pre-retirement documents stay active without a migration.
 */
export const ACTIVE_MACRO_COUNTRY_FILTER = { retiredAt: null } as const;

/** Code-level guard mirroring the filter, for adapters that ignore Mongo filters. */
export function isActiveMacroCountry(doc: Pick<MacroCountryState, "retiredAt">): boolean {
  return doc.retiredAt == null;
}

export interface DependencyRetirement {
  retiredAt: Date;
  retiredByRuleId: string;
  successorEntityId: WorldEntityId;
  updatedAt: Date;
}

/**
 * `$set` payload that retires a dissolved dependency's macro document.
 * History (sectors, contribution, dataQuality) is untouched — only the
 * retirement marker plus `updatedAt` change.
 */
export function buildDependencyRetirement(args: {
  ruleId: string;
  successorEntityId: WorldEntityId;
  now: Date;
}): DependencyRetirement {
  return {
    retiredAt: args.now,
    retiredByRuleId: args.ruleId,
    successorEntityId: args.successorEntityId,
    updatedAt: args.now,
  };
}
