import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { toCountryId } from "./countryContext";

function readQueryCountry(search?: string | null) {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return toCountryId(params.get("country"));
}

export async function resolveNavbarPageCountry(args: { pathname: string; search?: string | null }) {
  const queryCountry = readQueryCountry(args.search);
  if (queryCountry) return queryCountry;

  // 2-letter codes (US/UK/JP…) or 3 for the seceded nations (SCO/WAL).
  const countryPathMatch = args.pathname.match(/^\/country\/([a-z]{2,3})(?=\/|$)/i);
  if (countryPathMatch) {
    return toCountryId(countryPathMatch[1]);
  }

  if (args.pathname.startsWith("/uk")) {
    return "UK";
  }

  const sectorMatch = args.pathname.match(/^\/corporation\/([^/]+)\/sector\/([^/]+)$/i);
  const corporationMatch = args.pathname.match(/^\/corporation\/([^/]+)$/i);
  const corporationId = sectorMatch?.[1] ?? corporationMatch?.[1];

  if (!corporationId) return null;

  const corporationQuery = corporationQueryFromParamId(corporationId);
  if (!corporationQuery) return null;

  const db = await getDb();
  const corporation = await db
    .collection<{ _id: ObjectId; countryId?: string; headquartersState?: string }>("corporations")
    .findOne(corporationQuery, {
      projection: { _id: 1, countryId: 1, headquartersState: 1 },
    });
  if (!corporation) return null;

  let corporationCountry = toCountryId(corporation.countryId);
  if (!corporationCountry && corporation.headquartersState) {
    const hqState = await db
      .collection<State>("states")
      .findOne({ _id: corporation.headquartersState }, { projection: { countryId: 1 } });
    corporationCountry = toCountryId(hqState?.countryId);
  }

  if (!sectorMatch) {
    return corporationCountry;
  }

  const sectorId = sectorMatch[2];
  if (!ObjectId.isValid(sectorId)) {
    return corporationCountry;
  }

  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne(
      { _id: new ObjectId(sectorId), corporationId: corporation._id },
      { projection: { countryId: 1, stateId: 1 } }
    );

  const sectorCountry = toCountryId(sector?.countryId);
  if (sectorCountry) return sectorCountry;

  if (sector?.stateId) {
    const state = await db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { countryId: 1 } });
    const stateCountry = toCountryId(state?.countryId);
    if (stateCountry) return stateCountry;
  }

  return corporationCountry;
}
