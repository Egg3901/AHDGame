import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import {
  buildCanonicalSpawn,
  getCurrentTurnAndCtx,
  justResolvedInSameTurn,
  sendBatchedElectionAnnouncements,
} from "../engine";
import {
  IE_LOCAL_COUNCIL_SEATS,
  ensureRegionalGovernorElections,
  mirrorPeerRaceTiming,
} from "../shared";

/**
 * Ensure every IE region has an active/upcoming Dáil Éireann election.
 * Mirrors `ensureCNElections` — one multi-seat constituency election per
 * region, anchored to the preset's `ieDail` cycle anchor. A region that joins
 * mid-cycle (NI reunifying) syncs to the live Republic race instead.
 */
export async function ensureIEElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ieRegions = await db
    .collection<State>("states")
    .find({ countryId: "IE" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = ieRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Per-region Dáil magnitude (PR-STV multi-seat constituencies). Sourced from
  // the seeded State doc so it tracks the world's preset (1991 vs 2019) without
  // a hardcoded map. Falls back to 1 only if a region is missing the field.
  const seatsByRegion = new Map<string, number>(
    ieRegions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "dail",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "dail",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // A region with no prior Dáil race that joins while the rest of Ireland is
    // mid-cycle (NI reunifying) syncs to the live Republic race so they resolve
    // together; otherwise spawn its own canonical cycle.
    const peer = !prev ? liveElections[0] : undefined;
    const doc = peer
      ? mirrorPeerRaceTiming("IE", peer, regionId, "dail", seatsByRegion.get(regionId) ?? 1, now)
      : buildCanonicalSpawn({
          electionType: "dail",
          countryId: "IE",
          state: regionId,
          prev,
          currentTurn,
          now,
          fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
          ctx,
          openPrimaryImmediately: true,
        });
    if (!doc) continue;

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "dail" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureIEElections: spawned ${toActuallyInsert.length} missing Dáil election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── Beta parliamentary countries: FR/IT/ES/SE/TR lower chambers (#3239) ────

/**
 * Ensure a nationwide Uachtarán na hÉireann (President of Ireland) election
 * is active or upcoming. Single constituency (state = "IE"), single seat,
 * 7-year cycle. The 1.0 simulation uses the configured direct-plurality
 * resolver; preference-transfer fidelity remains a later electoral upgrade.
 *
 * Mirrors `ensureIEElections` for the spawn pattern but with a fixed
 * 1-element state list (the country code itself, since the Uachtarán race
 * is nationwide rather than per-region). Term limit (2 terms) enforced via
 * `executiveTermLimits.ts` reading the IE config's `executiveTermLimit`.
 */
export async function ensureIEUachtaranElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "uachtaran",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  if (liveElections.length > 0) return;

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "uachtaran",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const prev = completedElections[0];

  if (justResolvedInSameTurn(prev, now, currentTurn)) return;

  const doc = buildCanonicalSpawn({
    electionType: "uachtaran",
    countryId: "IE",
    state: "IE",
    prev,
    currentTurn,
    now,
    fallbackTotalSeats: 1,
    ctx,
    openPrimaryImmediately: true,
  });
  if (!doc) return;

  // Defensive: dedup against any concurrent insert.
  const existing = await db.collection<Election>("elections").findOne({
    countryId: "IE",
    electionType: "uachtaran",
    state: "IE",
    status: { $in: ["active", "upcoming"] },
  });
  if (existing) return;

  await db.collection<Election>("elections").insertOne(doc as Election);
  console.log(`[Turn] ensureIEUachtaranElections: spawned 1 Uachtarán election`);
  sendBatchedElectionAnnouncements([doc], now);
}

/**
 * Ensure every IE region has an active/upcoming Local Council election.
 * Mirrors `ensureIEElections` for the multi-seat per-region pattern,
 * sized from `IE_LOCAL_COUNCIL_SEATS`. 5-year canonical cycle anchored to
 * the preset's `ieLocalCouncil` year (2024 for 2019-default, 1991 for
 * 1991-default).
 */
export async function ensureIELocalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ieRegions = await db
    .collection<State>("states")
    .find({ countryId: "IE" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ieRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "localCouncil",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "localCouncil",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // A region joining mid-cycle (NI reunifying) syncs to the live council race.
    const peer = !prev ? liveElections[0] : undefined;
    const doc = peer
      ? mirrorPeerRaceTiming(
          "IE",
          peer,
          regionId,
          "localCouncil",
          IE_LOCAL_COUNCIL_SEATS[regionId] ?? 1,
          now
        )
      : buildCanonicalSpawn({
          electionType: "localCouncil",
          countryId: "IE",
          state: regionId,
          prev,
          currentTurn,
          now,
          fallbackTotalSeats: IE_LOCAL_COUNCIL_SEATS[regionId] ?? 1,
          ctx,
          openPrimaryImmediately: true,
        });
    if (!doc) continue;

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    countryId: "IE" as const,
    electionType: "localCouncil" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureIELocalCouncilElections: spawned ${toActuallyInsert.length} missing Local Council election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Spawn perpetual Cathaoirleach elections for all 8 IE regions on the
 * shared cross-country `governor` cycle (4-year canonical anchor). Single-
 * seat per region. Display label varies per region via
 * `getRegionalExecutive` (Lord Mayor of Dublin/Cork, Mayor of Limerick/
 * Galway, Cathaoirleach elsewhere) — see regionalExecutive.ts.
 */
export async function ensureIECathaoirleachElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("IE", now);
}
