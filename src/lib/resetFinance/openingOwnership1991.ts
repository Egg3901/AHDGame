import { openingLawReferences } from "@/lib/resetLegislation/openingLaw";
import { openingFiscalBooks1991, type ResetOpeningCountry } from "./opening1991";
import { reconcileOpeningOwnership } from "./rules/openingOwnership";

/** The only positive national source not represented by a proposed law family. */
const STANDALONE_CONTINUITY = {
  US: [],
  UK: [],
  JP: [
    {
      id: "jp_foreign_affairs_continuity",
      sourceId: "jp_foreign_aid",
      amount: 1_736_000_000_000,
    },
  ],
} as const;

export function openingFiscalOwnership1991() {
  const books = openingFiscalBooks1991();
  return Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country: ResetOpeningCountry) => {
      const claims = openingLawReferences
        .filter((reference) => reference.country === country && reference.scope === "national")
        .flatMap((reference) =>
          reference.sourceComponents
            .filter((component) => component.fiscalRole === "single-booked-owner")
            .map((component) => ({
              sourceId: component.sourceId,
              familyId: reference.familyId,
              amount: component.annualBooked,
              disposition: component.historicalDisposition,
              treatment: component.treatment,
            }))
        );
      return [
        country,
        reconcileOpeningOwnership(books[country].operating, claims, STANDALONE_CONTINUITY[country]),
      ];
    })
  ) as Record<ResetOpeningCountry, ReturnType<typeof reconcileOpeningOwnership>>;
}

/** Source-named transfers that must not become spendable Cabinet cash. */
export function openingNamedGrantClaims1991(): Record<ResetOpeningCountry, Record<string, number>> {
  return Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country) => {
      const byFamily: Record<string, number> = {};
      for (const reference of openingLawReferences) {
        if (reference.country !== country || reference.scope !== "national") continue;
        for (const source of reference.sourceComponents) {
          // Legal-lineage copies carry the same restriction, but only the
          // single-booked owner contributes cash to the grant ledger.
          if (source.fiscalRole !== "single-booked-owner") continue;
          // UK local-government settlement is the exact national grant line.
          // Both it and Japan's allocation tax need a separate transfer-change
          // path before any ordinary law option may replace them.
          const namedUkGrant =
            country === "UK" &&
            source.sourceId === "uk_local_government_funding" &&
            source.fiscalRole === "single-booked-owner";
          if (source.replacementRestriction !== "protected-transfer" && !namedUkGrant) continue;
          if (
            source.historicalDisposition !== "retained-legal-lineage" ||
            source.fiscalOwner !== reference.familyId
          ) {
            throw new Error(`Invalid named grant source ${country}:${source.sourceId}`);
          }
          byFamily[reference.familyId] = (byFamily[reference.familyId] ?? 0) + source.annualBooked;
        }
      }
      return [country, byFamily];
    })
  ) as Record<ResetOpeningCountry, Record<string, number>>;
}
