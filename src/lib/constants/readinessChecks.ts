import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ReadinessCheck } from "@/lib/constants/countryReadinessExpectations";

/**
 * Every country expects a `governmentFormations` doc keyed by its country id.
 *
 * ⚠️ LIVES IN ITS OWN MODULE TO BREAK A CYCLE. It was module-private in
 * `countryReadinessExpectations.ts`. Japan's expectations moved to
 * `countries/jp/institutions.ts` and its `extras` entry calls this, but the
 * registry imports those expectations -- so importing the check back out of the
 * registry would be a real runtime import cycle.
 *
 * ⚠️ MISSING IS AN ERROR, NOT A WARNING. A country with no formation doc has no
 * government at all, which is why this reports "missing" rather than degrading
 * to a warning the way an empty-but-present roster does.
 */
export async function checkGovernmentFormation(
  countryId: CountryId,
  db: Db
): Promise<ReadinessCheck> {
  const gov = await db
    .collection<{ _id: string; status?: string; cycle?: number }>("governmentFormations")
    .findOne({ _id: countryId });
  return {
    name: "GovernmentFormation",
    status: gov ? "ok" : "missing",
    detail: gov
      ? `Status: ${gov.status}, cycle: ${gov.cycle}`
      : `No ${countryId} governmentFormations doc`,
  };
}
