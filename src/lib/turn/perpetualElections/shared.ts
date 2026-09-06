import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { type CountryId } from "@/lib/constants/countries";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats";
import { snapAnchorEndTime } from "@/lib/elections/snapShift";
import {
  buildCanonicalSpawn,
  endTimeToLarpTurn,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  justResolvedInSameTurn,
  sendBatchedElectionAnnouncements,
} from "./engine";

/**
 * Config for one country's per-region multi-seat delegate election family
 * (CN NPC Delegate / CN Provincial Congress / BR Câmara today; the three RU
 * Supreme Soviet families in Phase 3). Every field below is the ONLY thing
 * that differed between the previously-duplicated spawners.
 */
export interface RegionalDelegateSpec {
  countryId: CountryId;
  /** electionType === officeType key (the CN convention). */
  electionType: string;
  /**
   * The AUTHORITATIVE per-region seat count, computed from the full region list
   * so families that apportion across regions can see every region at once.
   * Simple families return a constant map (CN, RU Nationalities) or derive
   * per-doc (RU Union: houseDistricts; RU republic soviets: stateSenateSeats).
   *
   * Authoritative, not advisory: a region present here has its spawned race
   * sized from this map even when a previous cycle said otherwise, because the
   * chamber's live size is the region docs and a race is a delegation to it.
   * OMIT a region the map cannot size — an absent entry means "no authoritative
   * number", and the spawn falls back to the previous cycle's count.
   *
   * `preset` is the ACTIVE world preset (`ctx.preset`) so era-apportioned
   * families can size the race the way the seed and the country config do —
   * CN's chamber is 2,980 deputies in the modern eras but 1,226 in 1953 (#3779).
   */
  seatsForRegions: (regions: State[], preset: string | undefined) => Record<string, number>;
  /** Open the primary immediately (short window vs multi-year cycle). CN/BR: true. */
  openPrimaryImmediately: boolean;
  /**
   * No-op unless the runtime country status is beta/active. CN/BR are always
   * live and omit this; RU (coming-soon, per-game enabled) sets it in Phase 3.
   */
  statusGated?: boolean;
  /**
   * Liveness gate applied when `statusGated`. Defaults to
   * `countryElectionsLive` (strict beta/active). RU overrides it with
   * `ruElectionsLive` so its Supreme Soviet also runs under the NPP governing
   * brain while RU itself stays `coming-soon` and never player-enabled (#3386).
   */
  electionsLiveGate?: (db: Db, countryId: CountryId) => Promise<boolean>;
  /** Human label for the log line + announcements, e.g. "NPC Delegate", "Câmara". */
  label: string;
}

/**
 * Seat map from the region field that sizes this chamber, OMITTING any region
 * the field does not size.
 *
 * The omission is the point. Substituting 1 for a missing field would make "this
 * region seats one deputy" indistinguishable from "this region doc cannot say",
 * and the caller treats a present entry as authoritative enough to overrule the
 * previous cycle — so a region that lost its field would have its delegation
 * forced to 1 rather than left alone.
 */
export function seatsFromRegionField(
  regions: State[],
  field: "houseDistricts" | "stateSenateSeats"
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const region of regions) {
    const seats = region[field];
    if (typeof seats === "number" && seats > 0) out[region._id as string] = seats;
  }
  return out;
}

/**
 * Heal `totalSeats` on a regional delegate race already in flight when its
 * chamber was resized (#1262).
 *
 * The spawn-time force below only reaches the NEXT cycle. A race running when
 * the region changed size is never corrected, and for these families that is not
 * cosmetic: `allocateSeats` overrides `totalSeats` from a live map for the US
 * House and the Commons ONLY, so every other family allocates over the number on
 * the Election doc. Sachsen's Landtag race carried the 1953 seed's 24 into a
 * chamber the region doc sizes at 161 — `rescaleRegionDelegations` had already
 * reseated the sitting delegation to 161, so resolving that race would have cut
 * it back to 24.
 *
 * Exactly the shape and the reason of {@link buildHouseSeatHealOps} (#1190) and
 * the Commons heal in {@link ensureUKElections}; this is the same repair for the
 * families the shared delegate spawner owns.
 */
export function buildDelegateSeatHealOps(
  liveElections: Pick<Election, "_id" | "state" | "totalSeats">[],
  seatMap: Record<string, number>,
  now: Date
): AnyBulkWriteOperation<Election>[] {
  return liveElections.flatMap((e) => {
    if (!e.state) return [];
    const expected = seatMap[e.state];
    // Absent or not a positive number means the region cannot size this chamber,
    // so there is nothing authoritative to heal towards — leave the race as it is
    // rather than zeroing it. Written as `!(expected > 0)` rather than
    // `expected <= 0` so a NaN seat count is REJECTED: every comparison against
    // NaN is false, so the `<= 0` form would fall through both guards and write
    // NaN over a perfectly good seat count. Same test the spawn-time force uses.
    if (!(typeof expected === "number" && expected > 0)) return [];
    if (e.totalSeats === expected) return [];
    return [
      {
        updateOne: {
          filter: { _id: e._id },
          update: { $set: { totalSeats: expected, updatedAt: now } },
        },
      },
    ];
  });
}

/**
 * Ensure every region of `spec.countryId` has an active/upcoming election of
 * `spec.electionType`. Canonical LARP scheduling via `buildCanonicalSpawn` —
 * no snap elections, no staggered classes. Extracted from the formerly-
 * duplicated ensureCNElections / ensureCNPeoplesCongressElections /
 * ensureBRElections bodies.
 */
export async function ensureRegionalDelegateElections(
  spec: RegionalDelegateSpec,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (spec.statusGated) {
    const gate = spec.electionsLiveGate ?? countryElectionsLive;
    if (!(await gate(db, spec.countryId))) return;
  }
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find(
      { countryId: spec.countryId },
      { projection: { _id: 1, houseDistricts: 1, stateSenateSeats: 1 } }
    )
    .toArray();
  if (regions.length === 0) return;
  const seatMap = spec.seatsForRegions(regions as State[], ctx.preset);

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: spec.countryId,
      electionType: spec.electionType,
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveStates = new Set(liveElections.map((e) => e.state));

  // Carry a resize onto the race that is already running, before deciding what
  // to spawn — a region present in `liveStates` gets no new doc, so without this
  // its correction would wait a whole cycle.
  const healOps = buildDelegateSeatHealOps(liveElections, seatMap, now);
  if (healOps.length > 0) {
    await db.collection<Election>("elections").bulkWrite(healOps);
    console.log(
      `[Turn] ensureRegionalDelegateElections(${spec.countryId}/${spec.electionType}): healed ${healOps.length} in-flight ${spec.label} seat count(s)`
    );
  }

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: spec.countryId,
      electionType: spec.electionType,
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const region of regions) {
    const regionId = region._id as string;
    if (liveStates.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const doc = buildCanonicalSpawn({
      electionType: spec.electionType,
      countryId: spec.countryId,
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatMap[regionId] ?? 1,
      ctx,
      openPrimaryImmediately: spec.openPrimaryImmediately,
    });
    if (!doc) continue;

    // buildCanonicalSpawn inherits `prev?.totalSeats`, which freezes a region's
    // delegation at whatever its FIRST cycle said and never consults the region
    // doc again. That is wrong wherever a chamber can be resized mid-game: after
    // German reunification the six pre-accession Laender still advertised their
    // 1953 Volkskammer allocation (Sachsen 151) while the live chamber sized
    // them from `houseDistricts` (Sachsen 55), so the elections page and the map
    // disagreed on every one of them (#1262). NG hit the same inheritance with
    // its buggy `totalSeats: 1` (#901) and forces the value in its own spawner;
    // this is that fix, in the shared helper, for every family routed through it.
    const authoritativeSeats = seatMap[regionId];
    if (typeof authoritativeSeats === "number" && authoritativeSeats > 0) {
      doc.totalSeats = authoritativeSeats;
    }

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: spec.electionType,
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
      `[Turn] ensureRegionalDelegateElections(${spec.countryId}/${spec.electionType}): spawned ${toActuallyInsert.length} missing ${spec.label} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── China: NPC Delegate elections ──────────────────────────────────────────

/**
 * Status/NPP-governed gate for DD election families (the RU shape): live when
 * the country is beta/active, or when an NPP brain governs a coming-soon DD so
 * its chamber re-elects instead of freezing.
 */
export async function ddElectionsLive(db: Db): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, "DD");
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

/**
 * Eastern-bloc NPP/beta election gate (DD/RU shape): live when the country is
 * beta/active, or when an NPP brain governs a coming-soon economy-preview row
 * so the assembly re-elects instead of freezing.
 */
export async function easternBlocElectionsLive(db: Db, countryId: CountryId): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, countryId);
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

export async function ensureEasternBlocAssemblyElections(
  countryId: CountryId,
  electionType: string,
  label: string,
  now: Date
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId,
      electionType,
      seatsForRegions: (regions) => seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label,
    },
    now
  );
}

/**
 * Clone a live peer race's timing for a region that joined mid-cycle (NI
 * reunifying into Ireland), so the newcomer's race resolves on the SAME schedule
 * as the rest of the country instead of opening its own canonical cycle. Mirrors
 * the Commons→regionalCouncil sync in {@link ensureUKRegionalCouncilElections}.
 */
export function mirrorPeerRaceTiming(
  countryId: CountryId,
  peer: Election,
  state: string,
  electionType: string,
  totalSeats: number,
  now: Date
): Omit<Election, "_id"> {
  return {
    countryId,
    electionType,
    state,
    seatId: getSeatIdFromElection({ countryId, electionType, state }),
    cycle: peer.cycle,
    electionYear: peer.electionYear,
    status: peer.status === "upcoming" ? "upcoming" : "active",
    totalSeats,
    startTime: peer.startTime,
    primaryEndTime: peer.primaryEndTime,
    endTime: peer.endTime,
    startTurn: peer.startTurn,
    primaryEndTurn: peer.primaryEndTurn,
    endTurn: peer.endTurn,
    durationHours: peer.durationHours,
    primaryDurationHours: peer.primaryDurationHours,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Runtime status gate for beta-country election spawners — same two-tier
 * DB-over-config source as {@link ngElectionsLive}: flipping the admin status
 * to "beta"/"active" turns the country's cycle on with no redeploy, and a
 * coming-soon country never spawns NPC elections on the live world. Explicit
 * allow-list so an unexpected status never silently enables spawning.
 */
export async function countryElectionsLive(db: Db, countryId: CountryId): Promise<boolean> {
  const { status } = await getCountryAccessFromDb(db, countryId);
  return status === "beta" || status === "active";
}

/**
 * RU-specific election gate (#3386). RU is intentionally `coming-soon` — its
 * economy/UI/forex aren't launch-ready — so it must NOT be flipped to
 * beta/active just to un-freeze its legislature. But under the standard
 * `countryElectionsLive` gate a `coming-soon` RU spawns nothing, so the Supreme
 * Soviet seeded at bootstrap is never re-elected (frozen forever).
 *
 * Decouple the two: RU's Supreme Soviet / Nationalities / republic-soviet
 * families run when EITHER
 *   - RU is genuinely live (`beta`/`active`) — the eventual launch, and the
 *     headless sim harness, which forces `status: "active"` for scoped
 *     countries; OR
 *   - RU is NPP-governed (global NPP autonomy ≥ v1 and RU still NOT
 *     player-enabled). `nppGoverned` is false whenever `enabledForPlayers` is
 *     true, so this path surfaces RU's legislature READ-ONLY (the NPP governing
 *     brain runs the elections, per-action APIs still block office-taking) —
 *     it never flips RU to player-live.
 *
 * Scoped to RU on purpose: NG/FR/IT/ES/SE/TR keep the strict beta/active gate.
 */
export async function ruElectionsLive(db: Db, _countryId: CountryId = "RU"): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, "RU");
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

/**
 * Ensure every region of a beta parliamentary country (FR/IT/ES/SE/TR) has an
 * active/upcoming lower-chamber election. Modeled on `ensureIEElections`:
 * one multi-seat regional election per region (seats = the seeded State doc's
 * `houseDistricts`, so chamber size tracks the world's preset — e.g. SE 1953
 * seeds the 230-seat Second Chamber, the modern seed the 349-seat Riksdag),
 * anchored to the preset's cycle anchor via `BETA_PARLIAMENT_CYCLES` in
 * canonicalCycle.ts. Era-gated presets (ES 1953-default: Franco dictatorship)
 * have a `null` anchor, so `buildCanonicalSpawn` returns null and the country
 * stays static by design.
 *
 * Gated on the runtime country status (beta/active) like NG, so coming-soon
 * worlds are unaffected.
 */
export async function ensureBetaParliamentElections(
  countryId: CountryId,
  electionType: string,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (!(await countryElectionsLive(db, countryId))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  // Include the country's snap type so a live snap suppresses regulars and a
  // resolved snap shifts the next regular's anchor (parity with UK/JP/DE).
  const snapType = `snap_${electionType}`;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: { $in: [electionType, snapType] },
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: { $in: [electionType, snapType] },
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Snap shift: only a resolved snap the country called itself drags the
    // anchor (priorEndTurn + period). Admin-accelerated regulars must NOT move
    // the LARP calendar, and neither must an IMPOSED snap. See
    // `snapAnchorEndTime`.
    const snapAnchor = snapAnchorEndTime(prev, snapType);
    const priorEndTurn = snapAnchor ? endTimeToLarpTurn(snapAnchor, now, currentTurn) : null;

    const spawn = pickNextCanonicalCycle({
      electionType,
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn,
      ctx,
    });
    if (!spawn) continue; // era-gated (ES 1953) or gate exhausted

    // Open the primary immediately (mirrors IE/BR/UK): the multi-year cycle
    // far exceeds the 48h window, so the canonical startTurn would otherwise
    // leave a long "Opens in X turns" dead zone. `primaryEndTurn`/`endTurn`
    // stay canonical so the general lands on its real-world year.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType,
      state: regionId,
      seatId: getSeatIdFromElection({ countryId, electionType, state: regionId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(electionType, spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? seatsByRegion.get(regionId) ?? 1,
      startTime,
      primaryEndTime,
      endTime,
      startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur.durationHours,
      primaryDurationHours: dur.durationHours - dur.generalDurationHours,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureBetaParliamentElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Ensure every region of a beta-tier country's SENATE has an active/upcoming
 * election. Sibling to `ensureBetaParliamentElections` (lower chambers): same
 * per-region multi-seat spawn shape and gate (`countryElectionsLive`), but
 * seats are sourced from `state.stateSenateSeats` — NOT `houseDistricts`,
 * which is the LOWER chamber's seat map and is seeded independently (see
 * `seedEconTierRosters.ts`, which sources `r.stateSenateSeats` for exactly
 * this reason).
 *
 * Without this spawner a lapsed senator's seat is NEVER refilled: no
 * equivalent of `ensureBetaParliamentElections` exists for any Senate, so
 * every upper chamber in the game trends toward empty as terms lapse with
 * nothing re-electing them (measured: TR Senate 100% vacant, FR 52.5%, IT
 * 11.4% vacant at turn 654 of a 1953-default world).
 *
 * No snap-election handling — unlike the lower-chamber spawner there is no
 * existing snap-senate concept in this codebase, so this intentionally omits
 * the `snap_${electionType}` family the lower-chamber spawner includes.
 *
 * SIMPLIFICATIONS (real-world structure vs. what's modeled here):
 *  - FR Sénat: real senators serve staggered terms via indirect election by
 *    departmental electoral colleges — one-third (pre-2004) or one-half
 *    (2004+) of seats renewed every 3 years, 9-year term per senator. This
 *    spawner elects the WHOLE chamber at once every 9 years instead, matching
 *    the country's own `upperElectionSystem.seatsContested: "all"`
 *    declaration. There's no seat-series/class data model for FR (unlike the
 *    US Senate's `senateClass` mechanism), so partial renewal is not modeled.
 *  - IT Senato della Repubblica: directly elected. Senato and Camera have
 *    been elected on the SAME DAY for the Republic's entire history (both
 *    dissolve together) — this rides the itCamera anchor (see
 *    `canonicalTurnsForCycle`'s "senato" case), which is historically
 *    accurate, not a simplification.
 *  - TR Senate of the Republic (Cumhuriyet Senatosu, 1961-1980): historically
 *    one-third renewed every 2 years (6-year term per senator), and abolished
 *    after the 1980 coup. This spawner elects the whole chamber at once on a
 *    fixed 6-year cycle and does not model partial renewal or the 1980
 *    abolition (era-gated off entirely outside 1953-default instead — see
 *    `trSenato` in cycleAnchorContext.ts).
 *  - ES Senado: era-gated OFF in 1953-default exactly like
 *    `congresoDiputados` (Franco dictatorship) via a shared null anchor —
 *    not a new simplification, mirrors the existing Congreso gate.
 */
export async function ensureBetaSenateElections(
  countryId: CountryId,
  electionType: string,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (!(await countryElectionsLive(db, countryId))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [r._id as string, (r as State).stateSenateSeats ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType,
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType,
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const spawn = pickNextCanonicalCycle({
      electionType,
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      ctx,
    });
    if (!spawn) continue; // era-gated (ES 1953, TR outside 1953-default) or gate exhausted

    // Open the primary immediately (mirrors ensureBetaParliamentElections):
    // the multi-year cycle far exceeds the 48h window, so the canonical
    // startTurn would otherwise leave a long dead zone.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType,
      state: regionId,
      seatId: getSeatIdFromElection({ countryId, electionType, state: regionId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(electionType, spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? seatsByRegion.get(regionId) ?? 1,
      startTime,
      primaryEndTime,
      endTime,
      startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur.durationHours,
      primaryDurationHours: dur.durationHours - dur.generalDurationHours,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureBetaSenateElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Standup-cycle spawner for a seceded country's devolved lower chamber
 * (SCO Holyrood / WAL Senedd). Modeled on `ensureIEElections`: one canonical
 * per-sub-region race (AMS constituency tier, seats = the sub-region's
 * `houseDistricts`), scheduled at the NEXT canonical cycle (no
 * `openPrimaryImmediately`) so carried-over MPs hold their seats until the
 * first standup election. A no-op until the country has states (post-secession
 * expansion), so it is safe to run every turn from the country-election phase.
 */
export async function ensureSecededChamberElections(
  countryId: CountryId,
  electionType: string,
  now: Date,
  opts?: { seatsByRegion?: Record<string, number>; seatsPerRegion?: number }
): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return; // not stood up yet — no-op
  // Seats per region: an explicit table (regional councils) or a fixed count
  // (governor = 1) overrides the chamber's per-region houseDistricts default.
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [
      r._id as string,
      opts?.seatsByRegion?.[r._id as string] ??
        opts?.seatsPerRegion ??
        (r as State).houseDistricts ??
        1,
    ])
  );

  // For a per-region chamber (regional councils), keep each region's
  // stateSenateSeats in step with the seat table so legislature pages and
  // elections agree on chamber size — mirrors ensureUKRegionalCouncilElections.
  if (opts?.seatsByRegion) {
    const seatSyncOps: AnyBulkWriteOperation<State>[] = Object.entries(opts.seatsByRegion).map(
      ([regionId, seats]) => ({
        updateOne: {
          filter: { _id: regionId, countryId, stateSenateSeats: { $ne: seats } },
          update: { $set: { stateSenateSeats: seats } },
        },
      })
    );
    if (seatSyncOps.length > 0) {
      await db.collection<State>("states").bulkWrite(seatSyncOps, { ordered: false });
    }
  }

  const liveElections = await db
    .collection<Election>("elections")
    .find({ countryId, electionType, status: { $in: ["active", "upcoming"] } })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({ countryId, electionType, status: { $in: ["completed", "resolved"] } })
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
      countryId,
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      freshStandup: true,
    });
    if (doc) toInsert.push(doc);
  }
  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));
  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureSecededChamberElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Regional-council seats per macro-region = the real number of council areas
 * grouped into each (Scotland's 32 / Wales's 22 principal areas), driving the
 * per-region regionalCouncil chamber size at standup.
 */
export const SCO_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  GLA: 6, // Glasgow City, East/West Dunbartonshire, Renfrewshire, East Renfrewshire, Inverclyde
  LOT: 4, // Edinburgh, East/Mid/West Lothian
  HIG: 6, // Highland, Argyll & Bute, Na h-Eileanan Siar, Orkney, Shetland, Moray
  GRA: 2, // Aberdeen City, Aberdeenshire
  TAY: 5, // Dundee, Angus, Perth & Kinross, Fife, Stirling
  STH: 6, // Scottish Borders, Dumfries & Galloway, East/North/South Ayrshire, South Lanarkshire
  CSC: 3, // North Lanarkshire, Falkirk, Clackmannanshire
};

export const WAL_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  CDF: 4, // Cardiff, Vale of Glamorgan, Monmouthshire, Newport
  SWA: 5, // Swansea, Carmarthenshire, Pembrokeshire, Bridgend, Neath Port Talbot
  VAL: 5, // Rhondda Cynon Taf, Merthyr Tydfil, Caerphilly, Blaenau Gwent, Torfaen
  MWA: 2, // Powys, Ceredigion
  NWW: 4, // Isle of Anglesey, Gwynedd, Conwy, Denbighshire
  NEW: 2, // Flintshire, Wrexham
};

/**
 * Per-region councillor seat allocation for the IE Local Council.
 * Distributed by population; 200 across the 8 NUTS-III regions, plus NIR's
 * allocation once it reunifies (population-proportional at the same ratio).
 * Mirrors the UK_REGIONAL_COUNCIL_SEATS pattern.
 */
export const IE_LOCAL_COUNCIL_SEATS: Record<string, number> = {
  DUB: 62,
  KIL: 26,
  COR: 25,
  DON: 21,
  GAL: 19,
  LIM: 18,
  WEX: 17,
  MID: 12,
  NIR: 95,
};

/**
 * Shared spawner for direct-elected regional executive (the "governor"
 * electionType) in countries that aren't covered by `ensurePerpetualElections`
 * (which is US-only).
 *
 * Used by UK FMs + Mayor of London (SCO/WAL/NIR/LON) and JP regional
 * governors (all 8 regions). Same mechanical shape: single-seat, 4-year
 * cycle (192 turns via `CYCLE_TURNS.governor`), preset-anchored via
 * `electionToLarpYear`. Mirrors `ensureDEElections` for Bundestag.
 *
 * `allowedStateIds`, when provided, restricts spawning to that subset
 * (UK's English non-London regions get no FM/Mayor); when omitted every
 * state in the country is eligible (JP).
 */
export async function ensureRegionalGovernorElections(
  countryId: CountryId,
  now: Date,
  allowedStateIds?: ReadonlySet<string>
): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  const stateIds = states
    .map((s) => s._id as string)
    .filter((id) => !allowedStateIds || allowedStateIds.has(id));
  if (stateIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: "governor",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveGov = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: "governor",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(stateId: string): Election | undefined {
    return completedElections.find((e) => e.state === stateId);
  }

  const dur = DEFAULT_DURATIONS.governor.durationHours;
  const genDur = getGeneralWindow("governor");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const stateId of stateIds) {
    if (liveGov.has(stateId)) continue;

    const prev = lastCompleted(stateId);

    // A region joining mid-cycle (NI reunifying → Cathaoirleach) syncs to a live
    // peer governor race so they resolve together, instead of opening its own.
    if (!prev && liveElections[0]) {
      toInsert.push(mirrorPeerRaceTiming(countryId, liveElections[0], stateId, "governor", 1, now));
      continue;
    }

    const spawn = pickNextCanonicalCycle({
      electionType: "governor",
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn: null,
      ctx,
    });
    if (!spawn) continue;

    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType: "governor",
      state: stateId,
      seatId: getSeatIdFromElection({ countryId, electionType: "governor", state: stateId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(
        "governor",
        spawn.cycle,
        undefined,
        undefined,
        ctx,
        countryId
      ),
      status: "active",
      totalSeats: 1,
      startTime: now,
      primaryEndTime,
      endTime,
      startTurn: currentTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur,
      primaryDurationHours: dur - genDur,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  // Guard against duplicates (same pattern as ensureDEElections).
  const orFilters = toInsert.map((e) => ({
    countryId,
    electionType: "governor" as const,
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
      `[Turn] ensureRegionalGovernorElections(${countryId}): spawned ${toActuallyInsert.length} missing governor election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/** UK regions whose devolved executive is the "governor" electionType.
 *  English non-London regions get no FM/Mayor and are skipped. */
export const UK_GOVERNOR_REGIONS: ReadonlySet<string> = new Set(["SCO", "WAL", "NIR", "LON"]);

/**
 * Spawn a US presidential election if none is currently active or upcoming.
 * Used by the admin "Spawn Presidential Election" tool. Bypasses the turn-year
 * check — invoke when the normal Spawn Missing Elections cron didn't create one.
 *
 * Anchors timing to the canonical LARP schedule via `pickNextCanonicalCycle`
 * so admin-recovery docs are indistinguishable from cron-spawned docs (same
 * `seatId`, `electionYear`, `startTime` / `primaryEndTime` / `endTime`).
 * When the canonical window has already eroded past the 24h+24h gate, falls
 * back to a `now`-anchored doc so the admin button still unblocks recovery.
 *
 * Atomic via findOneAndUpdate + upsert + $setOnInsert: if two admins click the
 * button simultaneously, only one document is inserted. The other call returns
 * the existing doc with created=false.
 */
export async function ensurePresidentialElection(
  now: Date
): Promise<{ message: string; electionId: string; created: boolean }> {
  const db = await getDb();
  const elections = db.collection<Election>("elections");

  // Compute the next cycle from the most recent completed/resolved race.
  // Doesn't need to be atomic — concurrent callers will compute the same
  // cycle; the upsert below ensures only one insertion actually lands.
  const latestPresident = await elections.findOne(
    { electionType: "president", countryId: "US", status: { $in: ["completed", "resolved"] } },
    { sort: { updatedAt: -1 } }
  );

  const dur = DEFAULT_DURATIONS.president.durationHours;
  const pdur = DEFAULT_DURATIONS.president.primaryDurationHours;
  const prevCycle = latestPresident?.cycle ?? 0;

  // Resolve canonical LARP timing for the next cycle. Falls back to a
  // now-anchored doc when the canonical window is unreachable (heavy admin
  // acceleration, far-past gate failure) so the recovery button still works.
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  const canonical = pickNextCanonicalCycle({
    electionType: "president",
    prevCycle,
    currentTurn,
    ctx,
  });

  let cycle: number;
  let startTime: Date;
  let primaryEndTime: Date;
  let endTime: Date;
  let startTurn: number;
  let primaryEndTurn: number;
  let endTurn: number;
  let status: "active" | "upcoming";
  if (canonical) {
    cycle = canonical.cycle;
    startTime = turnToWallClock(canonical.startTurn, now, currentTurn);
    primaryEndTime = turnToWallClock(canonical.primaryEndTurn, now, currentTurn);
    endTime = turnToWallClock(canonical.endTurn, now, currentTurn);
    startTurn = canonical.startTurn;
    primaryEndTurn = canonical.primaryEndTurn;
    endTurn = canonical.endTurn;
    status = canonical.startTurn <= currentTurn ? "active" : "upcoming";
  } else {
    cycle = prevCycle + 1;
    startTime = now;
    primaryEndTime = new Date(now.getTime() + pdur * 3_600_000);
    endTime = new Date(now.getTime() + dur * 3_600_000);
    startTurn = currentTurn;
    primaryEndTurn = currentTurn + pdur;
    endTurn = currentTurn + dur;
    status = "active";
  }

  const seatId = getSeatIdFromElection({
    countryId: "US",
    electionType: "president",
    state: "US",
  });
  const electionYear = electionToLarpYear("president", cycle, undefined, undefined, ctx);

  // findOneAndUpdate with upsert + $setOnInsert is atomic: if a matching
  // active/upcoming doc exists, it is returned and no insert happens;
  // otherwise a new doc is inserted with the $setOnInsert fields. With
  // returnDocument: "before", we get null on insert and the existing doc on hit.
  const previous = await elections.findOneAndUpdate(
    { electionType: "president", countryId: "US", status: { $in: ["active", "upcoming"] } },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        electionType: "president",
        state: "US",
        countryId: "US",
        seatId,
        cycle,
        electionYear,
        status,
        startTime,
        primaryEndTime,
        endTime,
        startTurn,
        primaryEndTurn,
        endTurn,
        durationHours: dur,
        primaryDurationHours: pdur,
        createdAt: now,
        updatedAt: now,
      } satisfies Election,
    },
    { upsert: true, returnDocument: "before" }
  );

  if (previous) {
    return {
      message: "A presidential election already exists.",
      electionId: previous._id.toString(),
      created: false,
    };
  }

  // No previous doc → the upsert just inserted. Read it back to return its _id.
  const inserted = await elections.findOne({
    electionType: "president",
    countryId: "US",
    status: { $in: ["active", "upcoming"] },
    cycle,
  });
  if (!inserted) {
    throw new Error("Failed to read back inserted presidential election");
  }
  return {
    message: "Presidential election spawned.",
    electionId: inserted._id.toString(),
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Admin Spawn-Elections Registry
// ---------------------------------------------------------------------------
// Used by /api/admin/elections/spawn/[code] to dispatch the right ensure
// function per country. To add a country, export an ensure function above
// and add an entry here. The handler returns a short message plus optional
// metadata; the route normalizes the response envelope.
