import {
  LEGAL_STRUCTURES,
  GENERIC_LEGAL_STRUCTURE,
  type LegalStructure,
  type LegalStructureId,
} from "@/lib/constants/legalStructures";
import type { CountryId } from "@/lib/constants/countries";

export function getDefaultLegalStructureId(
  countryId: CountryId,
  opts?: { isPrivate?: boolean }
): LegalStructureId {
  if (opts?.isPrivate) {
    const privateDefault = LEGAL_STRUCTURES.find(
      (s) => s.countryId === countryId && s.isPrivateDefault
    );
    if (privateDefault) return privateDefault.id;
  }
  const def = LEGAL_STRUCTURES.find((s) => s.countryId === countryId && s.isDefault);
  // Fall back to a neutral generic structure rather than throwing: countries
  // seeded without a bespoke default (e.g. the 1991-default preset's Cold-War
  // nations) must still be able to process corporationTurn.
  return def ? def.id : GENERIC_LEGAL_STRUCTURE.id;
}

function resolveStructureById(id: LegalStructureId): LegalStructure | undefined {
  return (
    LEGAL_STRUCTURES.find((s) => s.id === id) ??
    (id === GENERIC_LEGAL_STRUCTURE.id ? GENERIC_LEGAL_STRUCTURE : undefined)
  );
}

/**
 * A "listed-only" form: the country's public default in a jurisdiction that also
 * defines a private counterpart — UK PLC, IE PLC, NG PLC, DE AG, BR SA Aberta,
 * CN Gufen. Only a public (floated) corp may hold one. US C-Corp / JP KK are
 * public defaults with no private counterpart, so they are legitimately held
 * either way and are NOT listed-only.
 */
export function isListedOnlyStructure(
  structure: Pick<LegalStructure, "isDefault" | "countryId">
): boolean {
  if (!structure.isDefault) return false;
  return LEGAL_STRUCTURES.some((s) => s.countryId === structure.countryId && s.isPrivateDefault);
}

export function getLegalStructureForCorp(corp: {
  countryId: CountryId;
  legalStructure?: LegalStructureId;
  isPrivate?: boolean;
}): LegalStructure {
  const isPrivate = corp.isPrivate === true;
  if (corp.legalStructure) {
    const stored = resolveStructureById(corp.legalStructure);
    if (!stored) throw new Error(`Unknown legal structure: ${corp.legalStructure}`);
    // Self-correct a stored structure that contradicts the corp's listing state:
    // a private corp can't wear a listed-only form (PLC/AG/…), and a floated corp
    // shouldn't wear a private-default form (Ltd/GmbH/…). Fall through to the
    // derived default so the label can never contradict isPrivate.
    const mismatched =
      (isPrivate && isListedOnlyStructure(stored)) ||
      (!isPrivate && stored.isPrivateDefault === true);
    if (!mismatched) return stored;
  }
  const id = getDefaultLegalStructureId(corp.countryId, { isPrivate });
  const structure = resolveStructureById(id);
  if (!structure) throw new Error(`Unknown legal structure: ${id}`);
  return structure;
}
