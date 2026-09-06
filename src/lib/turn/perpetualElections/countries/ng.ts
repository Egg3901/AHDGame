import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { NG_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import {
  buildCanonicalSpawn,
  getCurrentTurnAndCtx,
  justResolvedInSameTurn,
  ngElectionsLive,
  sendBatchedElectionAnnouncements,
} from "../engine";

/**
 * Ensure every NG geopolitical zone has an active/upcoming House of
 * Representatives election. Mirrors `ensureBRElections` — one multi-seat
 * regional election per zone, anchored to the canonical `house` cycle.
 */
export async function ensureNGElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Each NG zone is a multi-seat House election sized by its houseDistricts
  // (95/50/53/72/47/43 = 360). Without this the spawn fell back to totalSeats=1,
  // so the whole chamber projected/resolved as 6 single-winner races (#901).
  const seatsByRegion = new Map<string, number>(
    ngRegions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "house",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "house",
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

    const doc = buildCanonicalSpawn({
      electionType: "house",
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (!doc) continue;

    // buildCanonicalSpawn inherits prev?.totalSeats, and NG's earlier cycles were
    // spawned with the buggy totalSeats=1 — so the fallback alone wouldn't heal
    // future cycles. A zone's House seat count is the fixed authoritative
    // houseDistricts, so force it here so every new cycle sizes correctly (#901).
    const authoritativeSeats = seatsByRegion.get(regionId);
    if (authoritativeSeats && authoritativeSeats > 0) {
      doc.totalSeats = authoritativeSeats;
    }

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "house" as const,
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
      `[Turn] ensureNGElections: spawned ${toActuallyInsert.length} missing House election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Per-zone NG elections for a non-House office (Senate or Governor). Mirrors
 * `ensureNGElections`; the seat docs (seedSeats) carry the per-zone seat counts,
 * so `fallbackTotalSeats` is only a backstop.
 */
export async function ensureNGZoneElections(
  now: Date,
  electionType: "senate" | "governor"
): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Senate is multi-seat per zone (stateSenateSeats: 18-21, summing to 109);
  // Governor is a single seat. Without sizing the Senate by stateSenateSeats the
  // spawn fell back to totalSeats=1 and each zone seated only 1 senator (NG).
  const seatsByRegion = new Map<string, number>(
    ngRegions.map((r) => [
      r._id as string,
      electionType === "senate" ? ((r as State).stateSenateSeats ?? 1) : 1,
    ])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", electionType, status: { $in: ["active", "upcoming"] } })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", electionType, status: { $in: ["completed", "resolved"] } })
    .sort({ updatedAt: -1 })
    .toArray();

  const lastCompleted = (regionId: string): Election | undefined =>
    completedElections.find((e) => e.state === regionId);

  const toInsert: Omit<Election, "_id">[] = [];
  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;
    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
    const doc = buildCanonicalSpawn({
      electionType,
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (doc) {
      // buildCanonicalSpawn inherits prev?.totalSeats, and NG's earlier senate
      // cycles were spawned with the buggy totalSeats=1 — force the authoritative
      // zone seat count so new cycles size correctly and self-heal (NG senate).
      const authoritativeSeats = seatsByRegion.get(regionId);
      if (authoritativeSeats && authoritativeSeats > 1) doc.totalSeats = authoritativeSeats;
      toInsert.push(doc);
    }
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
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
      `[Turn] ensureNG${electionType === "senate" ? "Senate" : "Governor"}Elections: spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

export async function ensureNGSenateElections(now: Date): Promise<void> {
  await ensureNGZoneElections(now, "senate");
}

export async function ensureNGGovernorElections(now: Date): Promise<void> {
  await ensureNGZoneElections(now, "governor");
}

/**
 * Ensure every NG zone has an active/upcoming State House of Assembly
 * (regionalCouncil) election. Mirrors ensureNGElections; per-zone multi-seat,
 * anchored to the concurrent general cycle. Seats from NG_REGIONAL_COUNCIL_SEATS.
 */
export async function ensureNGRegionalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "regionalCouncil",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "regionalCouncil",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const lastCompleted = (regionId: string): Election | undefined =>
    completedElections.find((e) => e.state === regionId);

  const toInsert: Omit<Election, "_id">[] = [];
  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;
    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
    const doc = buildCanonicalSpawn({
      electionType: "regionalCouncil",
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: NG_REGIONAL_COUNCIL_SEATS[regionId] ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (doc) toInsert.push(doc);
  }
  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "regionalCouncil" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));
  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureNGRegionalCouncilElections: spawned ${toActuallyInsert.length} Assembly election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * National NG presidential race. Resolution uses the bespoke
 * `nigeriaPresidentialElectionEngine` (national popular vote + federal-character
 * spread + run-off). Gated until NG is activated.
 */
export async function ensureNGPresidentialElection(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const live = await db.collection<Election>("elections").findOne({
    countryId: "NG",
    electionType: "president",
    status: { $in: ["active", "upcoming"] },
  });
  if (live) return;

  const prev = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "president",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .limit(1)
    .next();
  if (justResolvedInSameTurn(prev ?? undefined, now, currentTurn)) return;

  const doc = buildCanonicalSpawn({
    electionType: "president",
    countryId: "NG",
    state: "NG",
    prev: prev ?? undefined,
    currentTurn,
    now,
    fallbackTotalSeats: 1,
    ctx,
    openPrimaryImmediately: true,
  });
  if (!doc) return;

  await db.collection<Election>("elections").insertOne(doc as Election);
  console.log("[Turn] ensureNGPresidentialElection: spawned NG presidential race");
  sendBatchedElectionAnnouncements([doc], now);
}

// ─── Ireland: Dáil Éireann ──────────────────────────────────────────────────
