/**
 * Give the surviving country the absorbed country's legislation catalogue.
 *
 * `legislationTypes` is a GLOBAL collection keyed by id and tagged with a
 * `countryScope`. Nothing deletes those documents when a country dissolves, so
 * laws already enacted under them keep resolving and keep applying their
 * effects -- `applyOneProvision` looks a type up by `_id` alone. The enacted
 * laws are therefore left completely alone: rewriting a law's identity would
 * falsify the region's legislative history.
 *
 * What this fixes is what the survivor may NEWLY legislate. Germany's own 60
 * types are tax instruments (`de_income_tax_rate`, `de_vat_rate`); East
 * Germany's 115 are the socialist programme
 * (`dd.economy.workerSecurity.primary`, `dd.sec.machineTractorStations`). A
 * reunified one-party Germany that inherited only the first set could legislate
 * nothing but West German tax law, while the laws already on its books came from
 * a catalogue it could no longer touch. It takes the union of both.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export async function rescopeLegislationCatalogue(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<{ typesRescoped: number }> {
  if (fromCountryId === toCountryId) return { typesRescoped: 0 };
  // `countryScope` is lower-case throughout the collection ("dd", "de", "us"),
  // unlike CountryId.
  const res = await db
    .collection("legislationTypes")
    .updateMany(
      { countryScope: fromCountryId.toLowerCase() },
      { $set: { countryScope: toCountryId.toLowerCase(), updatedAt: new Date() } }
    );
  return { typesRescoped: res?.modifiedCount ?? 0 };
}
