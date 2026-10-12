import type { IndexFundTargetDefinition } from "../constituents";
import type { BondFundUniverse } from "../fundDefinitions";

/** Published index policy. Targets are execution output, not the mandate. */
export type IndexMandate = IndexFundTargetDefinition & {
  version: 1;
  mode: "index";
  bondUniverse?: BondFundUniverse;
};

/** Compatibility policy for books created before mandates were persisted. */
export function legacyIndexMandate(
  metadata: IndexFundTargetDefinition,
  originalPolicy?: Pick<IndexMandate, "topN" | "bondUniverse">
): IndexMandate {
  return {
    ...metadata,
    version: 1,
    mode: "index",
    ...(originalPolicy?.topN !== undefined ? { topN: originalPolicy.topN } : {}),
    ...(originalPolicy?.bondUniverse ? { bondUniverse: originalPolicy.bondUniverse } : {}),
    ...(metadata.kind === "bond" && !originalPolicy?.bondUniverse && metadata.countryId
      ? { bondUniverse: { issuerType: "sovereign", homeOnly: true } }
      : {}),
  };
}
