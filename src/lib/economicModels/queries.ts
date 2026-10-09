import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import { NATIONAL_SCOPE, getNationalDocId } from "@/lib/constants/nationalScope";

/**
 * Per-country lagged economic model, read from the national-scope macro docs.
 * Same source the corporation turn uses for the alignment margin term, so a
 * display surface shows the value the turn applied.
 */
export async function loadEconomicModelsByCountry(
  db: Db,
  countryIds: readonly string[]
): Promise<Map<string, EconomicModelState>> {
  const docIds = [
    ...new Set(
      countryIds
        .map((c) => getNationalDocId(c as CountryId))
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const out = new Map<string, EconomicModelState>();
  if (docIds.length === 0) return out;
  const docs = await db
    .collection<{ _id: string; economicModel?: EconomicModelState }>("macroMetrics")
    .find({ _id: { $in: docIds } }, { projection: { economicModel: 1 } })
    .toArray();
  for (const d of docs) {
    const cid = NATIONAL_SCOPE[String(d._id)];
    if (cid && d.economicModel) out.set(cid, d.economicModel);
  }
  return out;
}
