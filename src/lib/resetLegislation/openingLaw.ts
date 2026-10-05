/** Descriptive 1991 current-law references, never enactment authority. */
import references from "./openingLawReferences.json";
import type { ResetCountry } from "./fundingOwner";

export interface OpeningLawReference {
  key: string;
  country: ResetCountry;
  scope: "national" | "regional";
  familyId: string;
  status: string;
  currentLaw: string;
  legalNote: string;
  sourceComponents: readonly {
    sourceId: string;
    selectedOption: string;
    optionIndex: number;
    historicalDisposition: string;
    fiscalOwner: string;
    fiscalRole: string;
    annualBooked: number;
    treatment: string;
    replacementRestriction?: "protected-transfer";
  }[];
}

export const openingLawReferences: readonly OpeningLawReference[] =
  references as OpeningLawReference[];

export function openingLawReference(
  country: ResetCountry,
  scope: "national" | "regional",
  familyId: string
): OpeningLawReference | undefined {
  return openingLawReferences.find(
    (reference) =>
      reference.country === country && reference.scope === scope && reference.familyId === familyId
  );
}
