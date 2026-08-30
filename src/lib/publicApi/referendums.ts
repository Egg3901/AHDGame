import { ObjectId, type Db, type Filter } from "mongodb";
import type { PoliticalParty, Referendum, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

async function hydrateReferendums(db: Db, rows: Referendum[]) {
  const regionIds = [...new Set(rows.map((row) => row.regionId))];
  const partyKeys = [
    ...new Set(
      rows.flatMap((row) =>
        (row.partyPositions ?? []).map((position) => `${row.countryId}:${position.partyId}`)
      )
    ),
  ];
  const partyFilters = partyKeys.map((key) => {
    const [countryId, partyId] = key.split(":");
    return { countryId, sequentialId: Number(partyId) };
  });

  const [regions, parties] = await Promise.all([
    regionIds.length
      ? db
          .collection<State>("states")
          .find({ _id: { $in: regionIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([]),
    partyFilters.length
      ? db
          .collection<PoliticalParty>("politicalParties")
          .find({ $or: partyFilters } as Filter<PoliticalParty>)
          .toArray()
      : Promise.resolve([]),
  ]);
  const regionNames = new Map(regions.map((region) => [region._id, region.name]));
  const partyNames = new Map(
    parties.map((party) => [`${party.countryId}:${party.sequentialId}`, party.name])
  );

  return rows.map((row) => ({
    id: row._id?.toString() ?? null,
    countryId: row.countryId,
    region: { id: row.regionId, name: regionNames.get(row.regionId) ?? row.regionId },
    kind: row.kind,
    targetCountryId: row.targetCountryId,
    status: row.status,
    timing: {
      requestedTurn: row.requestedTurn,
      grantedTurn: row.grantedTurn,
      campaignOpenTurn: row.campaignOpenTurn,
      campaignCloseTurn: row.campaignCloseTurn,
      conversionDeadlineTurn: row.conversionDeadlineTurn,
    },
    campaign: {
      yesShare: row.yesShare,
      baseYesShare: row.campaignBaseYesShare,
      pollHistory: row.pollHistory ?? [],
      partyPositions: (row.partyPositions ?? []).map((position) => ({
        partyId: position.partyId,
        partyName: partyNames.get(`${row.countryId}:${position.partyId}`) ?? position.partyId,
        side: position.side,
        declaredTurn: position.declaredTurn,
      })),
    },
    result: row.result
      ? {
          yesShare: row.result.finalYesShare,
          noShare: Math.round((100 - row.result.finalYesShare) * 100) / 100,
          turnout: row.result.turnout,
          passed: row.result.passed,
          resolvedTurn: row.result.resolvedTurn,
        }
      : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }));
}

export async function queryReferendums(
  db: Db,
  params: { country?: CountryId; status?: Referendum["status"]; limit?: number } = {}
) {
  const filter: Filter<Referendum> = {};
  if (params.country) filter.countryId = params.country;
  if (params.status) filter.status = params.status;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = await db
    .collection<Referendum>("referendums")
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return { found: rows.length > 0, referendums: await hydrateReferendums(db, rows) };
}

export async function queryReferendum(db: Db, id: string) {
  if (!ObjectId.isValid(id)) return null;
  const row = await db.collection<Referendum>("referendums").findOne({ _id: new ObjectId(id) });
  if (!row) return null;
  return (await hydrateReferendums(db, [row]))[0] ?? null;
}
