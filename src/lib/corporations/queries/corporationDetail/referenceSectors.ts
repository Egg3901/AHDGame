import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { TurnReferenceData } from "@/lib/corporations/turnReferenceData";
import {
  buildSectorPresenceKeys,
  tariffRulesNeedSectorPresenceKeys,
} from "@/lib/tariffs/tariffEffects";
import { buildFtaCoverageLookup, type FtaCoverage } from "@/lib/tariffs/ftaOverrides";

export interface ReferenceSectorsResult {
  refData: TurnReferenceData;
  sectors: CorporateSector[];
  allSectorsRaw: CorporateSector[];
  corpByIdForTariffs: Map<string, Pick<Corporation, "_id" | "countryId">>;
  blendPresenceKeys: Set<string>;
  ftaCoverage: FtaCoverage;
}

/**
 * Reference-data + sector loads for the corporation detail view (#587).
 *
 * Awaits the already-initiated turn-reference promise alongside this corp's
 * own sectors and the all-sector tariff mirror, then builds the tariff
 * sector-presence inputs from the same raw rows the view always used.
 * `refDataPromise` is created by the caller before the share-invariant reads
 * so those round trips overlap, exactly as before.
 */
export async function loadReferenceSectors(
  db: Db,
  corporation: Corporation,
  refDataPromise: Promise<TurnReferenceData>
): Promise<ReferenceSectorsResult> {
  const [refData, sectors, allSectorsRaw] = await Promise.all([
    refDataPromise,
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({}, { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } })
      .toArray(),
  ]);
  const { allTariffs, activeFtaPairs } = refData;

  const sectorLookupCorpIds = [...new Set(allSectorsRaw.map((s) => s.corporationId.toString()))];
  const sectorLookupCorps =
    sectorLookupCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: sectorLookupCorpIds.map((cid) => new ObjectId(cid)) } },
            { projection: { _id: 1, countryId: 1 } }
          )
          .toArray()
      : [];
  const corpByIdForTariffs = new Map(sectorLookupCorps.map((corp) => [corp._id.toString(), corp]));
  const blendPresenceKeys = tariffRulesNeedSectorPresenceKeys(allTariffs)
    ? buildSectorPresenceKeys(allSectorsRaw, corpByIdForTariffs)
    : new Set<string>();
  const ftaCoverage = buildFtaCoverageLookup(allSectorsRaw, corpByIdForTariffs, activeFtaPairs);

  return { refData, sectors, allSectorsRaw, corpByIdForTariffs, blendPresenceKeys, ftaCoverage };
}
