import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import type { CabinetNomination } from "@/lib/db/types";

/**
 * Whip room label for a cabinet nomination: nominee plus the seat they were
 * nominated for, so whips can tell nominations apart. Keeps the "Cabinet:"
 * prefix the whip panels use to sort items into the Cabinet tab.
 */
export function cabinetNominationLabel(
  countryId: string,
  nom: Pick<CabinetNomination, "positionId" | "nomineeCharacterName">
): string {
  const positionName =
    nom.positionId === "vicePresident"
      ? "Vice President"
      : getCabinetPositions(countryId).find((p) => p.id === nom.positionId)?.name;
  return positionName
    ? `Cabinet: ${nom.nomineeCharacterName} for ${positionName}`
    : `Cabinet: ${nom.nomineeCharacterName}`;
}
