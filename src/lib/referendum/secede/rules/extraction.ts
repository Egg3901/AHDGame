import { scaleDeep } from "../docScale";
/** Capacity, depletion and offer fees divide; contractual percentage shares and rates do not. */
export function splitExtractionFields(
  doc: Record<string, unknown>,
  weight: number,
  countryId: string,
  regionId: string,
  capacity: boolean
): Record<string, unknown> {
  if (!(weight > 0 && weight <= 1)) throw new Error("Invalid extraction allocation");
  if (capacity)
    return {
      resources: scaleDeep(doc.resources, weight),
      ...(doc.extractedUnits ? { extractedUnits: scaleDeep(doc.extractedUnits, weight) } : {}),
    };
  return {
    ...(typeof doc.signingFeeAnchor === "number"
      ? { signingFeeAnchor: doc.signingFeeAnchor * weight }
      : {}),
    grantedBy: doc.grantedByLevel === "national" ? countryId : regionId,
  };
}
