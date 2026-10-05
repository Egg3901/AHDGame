import type { OpeningLawReference } from "../openingLaw";
import type { ResetCountry } from "../fundingOwner";
import type { UkTerritorialTaxOpening } from "@/lib/countries/uk/resetLegislation/ukTerritorialTax1991";

export interface ResetLawOpeningBoard {
  _id: string;
  worldId: string;
  countryId: ResetCountry;
  scope: "national" | "regional";
  regionId?: string;
  sourceTurn: number;
  /** UK 1991 local tax identity and unreconciled fiscal proxy. */
  ukTerritorialTax?: UkTerritorialTaxOpening;
  /** Current statutes and source fiscal obligations, not selectable policy levels. */
  references: Record<string, OpeningLawReference>;
}

export function buildResetLawOpeningBoard(input: {
  worldId: string;
  countryId: ResetCountry;
  regionId?: string;
  sourceTurn: number;
  references: readonly OpeningLawReference[];
  ukTerritorialTax?: UkTerritorialTaxOpening;
}): ResetLawOpeningBoard {
  if (!input.worldId || !Number.isSafeInteger(input.sourceTurn) || input.sourceTurn < 1) {
    throw new Error("Law opening board needs a world id and positive source turn");
  }
  if (input.regionId === "") throw new Error("Law opening board has an empty region id");
  const scope = input.regionId === undefined ? "national" : "regional";
  if (
    (input.countryId === "UK" && scope === "regional") !==
    (input.ukTerritorialTax !== undefined)
  ) {
    throw new Error("UK regional law opening requires its territorial tax fixture");
  }
  if (input.ukTerritorialTax && input.ukTerritorialTax.regionId !== input.regionId) {
    throw new Error("UK territorial tax fixture belongs to a different region");
  }
  if (input.references.length !== 60) {
    throw new Error(`Incomplete ${input.countryId}/${scope} 1991 current-law crosswalk`);
  }
  const ids = new Set<string>();
  for (const reference of input.references) {
    if (
      !reference.familyId ||
      ids.has(reference.familyId) ||
      reference.country !== input.countryId ||
      reference.scope !== scope ||
      reference.key !== `${input.countryId}:${scope}:${reference.familyId}` ||
      !reference.currentLaw.trim() ||
      !reference.legalNote.trim()
    ) {
      throw new Error(`Invalid ${input.countryId}/${scope} current-law reference`);
    }
    ids.add(reference.familyId);
    const sourceIds = new Set<string>();
    for (const source of reference.sourceComponents) {
      if (
        !source.sourceId ||
        sourceIds.has(source.sourceId) ||
        !Number.isFinite(source.annualBooked) ||
        source.annualBooked < 0 ||
        (source.replacementRestriction !== undefined &&
          source.replacementRestriction !== "protected-transfer")
      ) {
        throw new Error(`Invalid ${reference.key} source component`);
      }
      sourceIds.add(source.sourceId);
    }
  }
  return {
    _id: `${input.countryId}:${input.regionId ?? "national"}`,
    worldId: input.worldId,
    countryId: input.countryId,
    scope,
    ...(input.regionId === undefined ? {} : { regionId: input.regionId }),
    sourceTurn: input.sourceTurn,
    ...(input.ukTerritorialTax ? { ukTerritorialTax: input.ukTerritorialTax } : {}),
    references: Object.fromEntries(
      [...input.references]
        .sort((a, b) => a.familyId.localeCompare(b.familyId))
        .map((reference) => [reference.familyId, reference])
    ),
  };
}

/** Canonical legal and booked-source content for a persisted opening audit. */
export function resetLawOpeningBoardPayload(boards: readonly ResetLawOpeningBoard[]): string {
  return JSON.stringify(
    [...boards]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((board) => [
        board._id,
        board.worldId,
        board.countryId,
        board.scope,
        board.regionId ?? null,
        board.sourceTurn,
        board.ukTerritorialTax ?? null,
        Object.entries(board.references)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, reference]) => [
            id,
            reference.key,
            reference.status,
            reference.currentLaw,
            reference.legalNote,
            reference.sourceComponents.map((component) => [
              component.sourceId,
              component.selectedOption,
              component.optionIndex,
              component.historicalDisposition,
              component.fiscalOwner,
              component.fiscalRole,
              component.annualBooked,
              component.treatment,
              component.replacementRestriction ?? null,
            ]),
          ]),
      ])
  );
}
