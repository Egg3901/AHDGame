import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryHistoryCollection } from "@/lib/db/collections";
import type { CountryHistoryEvent } from "@/lib/db/types/countryHistoryEvent";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";

export async function queryCountryHistory(
  db: Db,
  countryId: string,
  params: { limit?: number; type?: string; beforeTurn?: number } = {}
) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const filter: Record<string, unknown> = { countryId };
  if (params.type) filter.eventType = params.type;
  if (params.beforeTurn !== undefined) filter.turn = { $lt: params.beforeTurn };

  const events = await (
    await getCountryHistoryCollection(db)
  )
    .find(filter)
    .sort({ turn: -1, timestamp: -1 })
    .limit(limit)
    .toArray();

  if (events.length === 0) return { found: false, events: [] as unknown[] };

  return {
    found: true,
    events: events.map((e: CountryHistoryEvent) => ({
      id: e._id.toString(),
      turn: e.turn,
      eventType: e.eventType,
      title: e.title,
      officeType: e.officeType ?? null,
      characterId: e.characterId?.toString() ?? null,
      characterName: e.characterName ?? null,
      party: e.party ?? null,
      billScope: e.billScope ?? null,
      details: e.details ?? null,
      iteration: e.iteration ?? null,
      iterationStartingYear: e.iterationStartingYear ?? null,
      timestamp: e.timestamp?.toISOString() ?? null,
    })),
  };
}

export interface PublicConflictSide {
  label: string;
  countries: string[];
  kind: string;
  backer: string | null;
}

function publicSide(side: ConflictDoc["sideA"]): PublicConflictSide {
  return {
    label: side.label,
    countries: side.countries ?? [],
    kind: side.kind,
    backer: side.backer ?? null,
  };
}

export async function queryConflicts(
  db: Db,
  params: { country?: string; status?: string; limit?: number } = {}
) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const filter: Record<string, unknown> = {};
  if (params.status) {
    filter.status = params.status;
  }
  if (params.country) {
    const c = params.country.toUpperCase();
    const cid = c as CountryId;
    filter.$or = [{ hostCountry: c }, { "sideA.countries": cid }, { "sideB.countries": cid }];
  }

  // conflictId (sequential per-iteration public number) is the natural sort.
  const conflicts = await db
    .collection<ConflictDoc>("conflicts")
    .find(filter)
    .sort({ conflictId: -1 })
    .limit(limit)
    .toArray();

  if (conflicts.length === 0) return { found: false, conflicts: [] as unknown[] };

  return {
    found: true,
    conflicts: conflicts.map((c) => ({
      conflictId: c.conflictId,
      name: c.name,
      hostCountry: c.hostCountry,
      region: c.region,
      type: c.type,
      status: c.status,
      bloc: c.bloc,
      terrain: c.terrain,
      severity: c.severity,
      intensity: c.intensity,
      control: c.control,
      controlStart: c.controlStart ?? null,
      supplyA: c.supplyA,
      supplyB: c.supplyB,
      sideA: publicSide(c.sideA),
      sideB: publicSide(c.sideB),
    })),
  };
}

export async function queryBattleReports(db: Db, countryId: string, limit = 50) {
  const clamped = Math.min(Math.max(limit, 1), 200);
  const cid = countryId as CountryId;
  const reports = await db
    .collection<BattleReportDoc>("battleReports")
    .find({ $or: [{ declarerCountry: cid }, { targetCountry: cid }] })
    .sort({ turn: -1 })
    .limit(clamped)
    .toArray();

  if (reports.length === 0) return { found: false, battles: [] as unknown[] };

  return {
    found: true,
    battles: reports.map((b) => ({
      id: b._id.toString(),
      theaterId: b.theaterId,
      declarerCountry: b.declarerCountry,
      targetCountry: b.targetCountry,
      attackers: b.attackers ?? [b.declarerCountry],
      defenders: b.defenders ?? [],
      turn: b.turn,
      result: b.result,
      noContact: b.noContact ?? false,
      unopposedAdvance: b.unopposedAdvance ?? false,
      controlBefore: b.controlBefore ?? null,
      controlAfter: b.controlAfter ?? null,
    })),
  };
}
