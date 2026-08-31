/**
 * Resolve a law another country wrote that this country now OWNS.
 *
 * Several engine gates key a statute per country through a compiled
 * `*_BY_COUNTRY` table (the reserve-forces law behind conscription, the
 * antitrust primary behind merger review) with a fail-open contract: no entry,
 * no law, gate off. A country MERGE breaks that assumption — the survivor
 * inherits the absorbed state's whole catalogue (`rescopeLegislationCatalogue`
 * flips `legislationTypes.countryScope`), so post-reunification Germany holds
 * East Germany's reserve and competition statutes even though no table ever
 * listed DE. The winner's law governs the unified state, so a table miss must
 * check for a carried statute before failing open.
 *
 * The scope check keeps this inert everywhere else: a country that never
 * absorbed anyone scopes none of the known ids, and the lookup costs one
 * indexed findOne only on the table-miss path.
 */
import type { Db } from "mongodb";

export async function carriedLawIdFor(
  db: Db,
  countryId: string,
  knownLawIds: readonly string[]
): Promise<string | null> {
  if (knownLawIds.length === 0) return null;
  const carried = await db.collection("legislationTypes").findOne(
    {
      _id: { $in: [...knownLawIds] },
      countryScope: countryId.toLowerCase(),
    } as never,
    { projection: { _id: 1 } }
  );
  return carried ? String(carried._id) : null;
}
