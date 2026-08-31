/**
 * Shared Parliamentary Government Logic
 *
 * Country-parameterized functions for seat tallying, government formation,
 * vote processing, NPP auto-aye, and PM appointment. Used by every
 * parliamentary country (UK, JP, DE, …).
 *
 * All config values (chamber key, majority threshold, total seats) are derived
 * from CountryConfig — no hardcoded country-specific values.
 *
 * UK-specific files (ukGovernmentFormation.ts, ukGovernment.ts) delegate to
 * these functions with countryId: "UK".
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Character,
  ElectedOfficial,
  NPP,
  PoliticalParty,
  CareerEvent,
  OfficeType,
  BillStatus,
} from "@/lib/db/types";
import type { Coalition } from "@/lib/db/types/coalition";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import {
  type CountryId,
  getCountryConfig,
  COUNTRY_ORDER,
  getExecutiveOfficeKey,
  isParliamentarySystem,
} from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getJointSittingOfficeTypes,
} from "@/lib/legislature/chamberOfficeType";
import {
  getLiveLowerChamberSeats,
  lowerChamberMajorityThreshold,
} from "@/lib/turn/lowerChamberSeats";
import { computeParliamentaryGovernmentTally } from "@/lib/congress/governmentVoteBreakdown";
import { PM_VACANCY_DEADLINE_TURNS } from "@/lib/constants/turnTime";
import { PM_VOTE_DURATION_HOURS } from "@/lib/constants/governmentFormation";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";
import { getGameState } from "@/lib/gameState";
import { getOfficeLabel } from "@/lib/utils/politics";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { installNewLeader, renewLeaderMandate } from "@/lib/turn/rulingPartyConfidence";
import { canFormGovernment, canCollapseGovernment } from "@/lib/turn/onePartyConstraints";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import { logger } from "../observability/logger";
import { resolveGoverningPartyIdsFromDocuments } from "@/lib/government/governingPartyIds";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

export { resolveGoverningPartyIdsFromDocuments };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a PM-appointment / no-confidence vote's window has closed. Prefers
 * the turn-based `closesOnTurn` (drift-immune, freezes on pause); falls back to
 * the legacy `closesAt` Date for docs not yet backfilled. The Date fallback is
 * retained as a permanent safety net for legacy/un-backfilled docs.
 */
export function isVoteClosed(
  vote: { closesOnTurn?: number | null; closesAt?: Date | null },
  currentTurn: number,
  effectiveNow: Date
): boolean {
  if (typeof vote.closesOnTurn === "number") return currentTurn >= vote.closesOnTurn;
  return !!vote.closesAt && effectiveNow.getTime() >= vote.closesAt.getTime();
}

/**
 * Sum seats held by each party from electedOfficials, scoped to the lower
 * chamber of the given country.
 */
export async function tallySeatsByParty(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<Record<string, number>> {
  const activePreset = preset ?? (await getGameStatePreset(db));
  const lowerOfficeType = getLowerChamberOfficeType(countryId, activePreset);

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: lowerOfficeType, countryId })
    .toArray();

  const seats: Record<string, number> = {};
  for (const official of officials) {
    if (!official.party) continue;
    seats[official.party] = (seats[official.party] ?? 0) + (official.seatsHeld ?? 1);
  }
  return seats;
}

/**
 * Return the party key (sequentialId string) with the most seats,
 * or null when the map is empty.
 */
export function getLargestParty(seatsByParty: Record<string, number>): string | null {
  const entries = Object.entries(seatsByParty);
  if (entries.length === 0) return null;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

/**
 * Pick the Leader of the Opposition for a parliamentary country.
 *
 * Considers both single parties and opposition coalitions, selecting whichever
 * non-governing entity has the largest seat total and a resolvable chair.
 * Coalition seats are summed from the provided `seatsByParty` map (typically
 * derived from `electedOfficials` or a canonical `governmentFormations` doc).
 *
 * Returns null when no opposition entity has both seats and a chair.
 */
export async function resolveOppositionLeader(
  db: Db,
  countryId: CountryId,
  seatsByParty: Record<string, number>,
  govPartyIds: Set<string>,
  partyBySeq: Map<string, PoliticalParty>
): Promise<{ chairId: ObjectId; partyDoc: PoliticalParty | null } | null> {
  let bestSeats = 0;
  let bestChairId: ObjectId | null = null;
  let bestPartyDoc: PoliticalParty | null = null;

  // Which parties are excluded from opposition consideration. When a government
  // has formed, that's the governing party plus any coalition partners. When no
  // government has formed yet (govPartyIds empty — e.g. a pending formation with
  // no coalition), the plurality winner is the presumptive majority that the UI
  // header surfaces as the "Majority Party", so the Opposition Leader is the
  // chair of the largest *other* party. Without this, the plurality winner's own
  // chair would be wrongly returned as the Opposition Leader.
  const pluralityPartyId = getLargestParty(seatsByParty);
  const excludedPartyIds =
    govPartyIds.size > 0 ? govPartyIds : new Set(pluralityPartyId ? [pluralityPartyId] : []);

  // Single opposition parties. Pick the seated chair when filled, otherwise
  // fall back to the vice-chair (acting as chair) per the 2026-05-22 rule.
  for (const [seqKey, seats] of Object.entries(seatsByParty)) {
    if (excludedPartyIds.has(seqKey)) continue;
    const doc = partyBySeq.get(seqKey);
    if (!doc) continue;
    const actingChair = doc.chairId ?? doc.viceChairId ?? null;
    if (!actingChair) continue;
    if (seats > bestSeats) {
      bestSeats = seats;
      bestChairId = actingChair;
      bestPartyDoc = doc;
    }
  }

  // Opposition coalitions (by combined seat total)
  const coalitions = await db.collection<Coalition>("coalitions").find({ countryId }).toArray();

  for (const coalition of coalitions) {
    const memberIds = coalition.members.map((m) => m.partySequentialId.toString());
    if (memberIds.some((id) => excludedPartyIds.has(id))) continue;

    const coalitionSeats = memberIds.reduce((sum, id) => sum + (seatsByParty[id] ?? 0), 0);
    if (coalitionSeats > bestSeats && coalition.chairCharacterId) {
      bestSeats = coalitionSeats;
      bestChairId = coalition.chairCharacterId;
      const largestMember = memberIds
        .map((id) => ({ id, seats: seatsByParty[id] ?? 0 }))
        .sort((a, b) => b.seats - a.seats)[0];
      bestPartyDoc = largestMember ? (partyBySeq.get(largestMember.id) ?? null) : null;
    }
  }

  if (!bestChairId) return null;
  return { chairId: bestChairId, partyDoc: bestPartyDoc };
}

// ---------------------------------------------------------------------------
// Per-turn seat update
// ---------------------------------------------------------------------------

/**
 * Ensure a `governmentFormations` document exists for a parliamentary country.
 *
 * The UK seeds its document from legacy collections via its own seat-update
 * override; every other parliamentary country gets its document from an
 * explicit admin seed step (e.g. the `ieGovernmentFormation` /
 * `cnGovernmentFormation` targets). When that step was never run — or the
 * document was wiped — there is no "pending" status for the executive hub to
 * gate the appointment flow on, so a qualifying party/coalition chair sees no
 * way to nominate a head of government (the symptom that motivated this fix).
 *
 * This self-heals that case by creating a fresh `pending` document derived
 * from country config plus a live seat tally. It is a no-op when a document
 * already exists, so a formed or pending government is never clobbered.
 *
 * Returns the created document, or null when one already existed.
 */
export async function ensureParliamentaryGovernmentFormation(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<GovernmentFormation | null> {
  const govCol = getGovernmentFormationsCollection(db);
  const existing = await govCol.findOne({ _id: countryId });
  if (existing) return null;

  const seatsByParty = await tallySeatsByParty(db, countryId, preset);
  const totalSeats = await getLiveLowerChamberSeats(db, countryId);
  const now = new Date();

  const doc: GovernmentFormation = {
    _id: countryId,
    countryId,
    cycle: 1,
    status: "pending",
    formationType: null,
    lostMajority: false,
    pmCharacterId: null,
    pmName: null,
    governingPartyId: getLargestParty(seatsByParty),
    coalitionId: null,
    coalitionPartyIds: null,
    totalSeatsSupporting: 0,
    majorityThreshold: lowerChamberMajorityThreshold(totalSeats),
    seatsByParty,
    totalSeats,
    activeVoteId: null,
    formedAt: null,
    formedTurn: null,
    collapsedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Upsert (rather than insert) so a concurrent seed loses the race cleanly
  // instead of throwing on a duplicate _id.
  await govCol.updateOne({ _id: countryId }, { $set: doc }, { upsert: true });
  return doc;
}

/**
 * Recalculate current lower chamber seat distribution and persist it to the
 * governmentFormations document for the given country.
 *
 * For coalition governments the supporting-seat total is derived from the
 * live coalition membership. Sets lostMajority when a formed majority/coalition
 * drops below the country's coalition threshold.
 */
export async function updateParliamentaryGovernmentSeats(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<void> {
  const totalSeats = await getLiveLowerChamberSeats(db, countryId);
  const majorityThreshold = lowerChamberMajorityThreshold(totalSeats);
  const govCol = getGovernmentFormationsCollection(db);

  const existing = await govCol.findOne({ _id: countryId });
  if (!existing) {
    // No document yet — self-heal by seeding a fresh pending formation from
    // config so the appointment flow becomes available. The seeded doc already
    // carries the live seat snapshot, so there is no same-turn delta to apply.
    await ensureParliamentaryGovernmentFormation(db, countryId, preset);
    return;
  }

  const seatsByParty = await tallySeatsByParty(db, countryId, preset);
  const now = new Date();

  // Safety net: if government is "formed" but PM is vacant, collapse to "pending"
  if (existing.status === "formed" && existing.pmCharacterId) {
    const pmStillExists = await db
      .collection<Character>("characters")
      .findOne({ _id: existing.pmCharacterId }, { projection: { _id: 1 } });
    if (!pmStillExists) {
      const governingPartyId = getLargestParty(seatsByParty);
      const gs = await db
        .collection<{ _id: string; currentTurn: number }>("gameState")
        .findOne({ _id: "current" });
      const currentTurn = gs?.currentTurn ?? 0;
      await govCol.updateOne(
        { _id: countryId },
        {
          $set: {
            status: "pending",
            formationType: null,
            lostMajority: false,
            pmCharacterId: null,
            pmName: null,
            governingPartyId,
            activeVoteId: null,
            seatsByParty,
            // Start the 96-turn vacancy clock for the orphaned-PM safety net.
            pmVacancyDeadlineTurn: currentTurn + PM_VACANCY_DEADLINE_TURNS,
            updatedAt: now,
          },
        }
      );
      // Clear cabinet (clearCabinetOnTransition handles all parliamentary/OPS
      // countries; the extra cabinetMembers sweep catches any stray positions).
      await Promise.all([
        clearCabinetOnTransition(db, countryId),
        db.collection("ukCabinetCooldowns").deleteMany({ countryId }),
        db.collection("cabinetMembers").deleteMany({ countryId }),
      ]);
      return;
    }
  }

  let totalSeatsSupporting: number;

  // Track coalition seats when coalitionId is set — covers both "coalition" and
  // "minority" formation types that were formed by a coalition chair
  if (existing.coalitionId != null) {
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: existing.coalitionId, countryId });
    const coalitionPartyIds = (coalition?.members ?? []).map((m) => String(m.partySequentialId));
    totalSeatsSupporting = coalitionPartyIds.reduce(
      (sum, partyId) => sum + (seatsByParty[partyId] ?? 0),
      0
    );
  } else {
    totalSeatsSupporting = existing.governingPartyId
      ? (seatsByParty[existing.governingPartyId] ?? 0)
      : 0;
  }

  // RUNTIME governmentType, not the static config. A country converted at
  // runtime — reunified Germany, or any `regime_change` peace term — is a
  // one-party state that `getCountryConfig` will never describe as one, so the
  // static read left the generic collapse path live in exactly the states it
  // exists to protect.
  const collapseRuntime = await getCountryState(db, countryId);
  const lostMajority =
    canCollapseGovernment({ governmentType: collapseRuntime.governmentType }) &&
    existing.status === "formed" &&
    (existing.formationType === "majority" || existing.formationType === "coalition") &&
    totalSeatsSupporting < majorityThreshold;

  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        seatsByParty,
        totalSeatsSupporting,
        lostMajority,
        // Refresh the stored chamber size + threshold so a runtime change in
        // region count (a region transfer) is reflected in the majority math.
        totalSeats,
        majorityThreshold,
        updatedAt: now,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Post-election reset
// ---------------------------------------------------------------------------

/**
 * Reset parliamentary government after a lower chamber election completes.
 * Cancels in-flight votes, increments cycle, recalculates seats.
 * If a PM is sitting and retains support, they survive. Otherwise full reset.
 */
export async function resetParliamentaryGovernmentAfterElection(
  db: Db,
  countryId: CountryId,
  now: Date
): Promise<void> {
  const totalSeats = await getLiveLowerChamberSeats(db, countryId);
  const majorityThreshold = lowerChamberMajorityThreshold(totalSeats);
  const govCol = getGovernmentFormationsCollection(db);

  const [existing, seatsByParty, gameStateDoc] = await Promise.all([
    govCol.findOne({ _id: countryId }),
    tallySeatsByParty(db, countryId),
    db.collection<{ _id: string; currentTurn: number }>("gameState").findOne({ _id: "current" }),
  ]);

  const cycle = (existing?.cycle ?? 0) + 1;
  const currentTurn = gameStateDoc?.currentTurn ?? 0;

  // Cancel any in-flight votes
  await Promise.all([
    getPMAppointmentVotesCollection(db).updateMany(
      { countryId, status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    ),
    getNoConfidenceVotesCollection(db).updateMany(
      { countryId, status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    ),
  ]);

  const hasSittingPM = existing?.status === "formed" && existing.pmCharacterId;

  if (hasSittingPM) {
    let totalSeatsSupporting: number;

    // Track coalition seats when coalitionId is set — covers both "coalition" and
    // "minority" formation types that were formed by a coalition chair
    if (existing.coalitionId != null) {
      const coalition = await db
        .collection<Coalition>("coalitions")
        .findOne({ sequentialId: existing.coalitionId, countryId });
      const coalitionPartyIds = (coalition?.members ?? []).map((m) => String(m.partySequentialId));
      totalSeatsSupporting = coalitionPartyIds.reduce(
        (sum, pid) => sum + (seatsByParty[pid] ?? 0),
        0
      );
    } else {
      totalSeatsSupporting = existing.governingPartyId
        ? (seatsByParty[existing.governingPartyId] ?? 0)
        : 0;
    }

    // RUNTIME governmentType — same argument as in
    // `updateParliamentaryGovernmentSeats`: the static config never learns about
    // a runtime conversion, so the one-party collapse lock did not apply to the
    // states it exists to protect.
    const collapseRuntime = await getCountryState(db, countryId);
    const lostMajority =
      canCollapseGovernment({ governmentType: collapseRuntime.governmentType }) &&
      (existing.formationType === "majority" || existing.formationType === "coalition") &&
      totalSeatsSupporting < majorityThreshold;

    await govCol.updateOne(
      { _id: countryId },
      {
        $set: {
          cycle,
          seatsByParty,
          totalSeatsSupporting,
          lostMajority,
          activeVoteId: null,
          noConfidenceCooldown: null,
          updatedAt: now,
        },
      }
    );
  } else {
    const governingPartyId = getLargestParty(seatsByParty);

    // Helper handles status/pm fields, cabinet clear, currentOffice clear, and
    // re-arms the vacancy clock. collapsedAt: null (post-election semantics:
    // fresh cycle clears collapse context). No-op when the formation record
    // is missing; the upsert below covers first-time creation.
    await unformGovernmentAndVacatePM(db, countryId, now, { reason: "post-election" });

    // Cycle-specific fields (not owned by the vacate helper). Upsert ensures
    // first-run creation for countries seeded without a formation record.
    // Duplicates helper fields so the upsert branch produces a complete
    // document; on the non-upsert path, these writes are idempotent.
    await govCol.updateOne(
      { _id: countryId },
      {
        $set: {
          _id: countryId,
          countryId,
          cycle,
          status: "pending",
          formationType: null,
          lostMajority: false,
          pmCharacterId: null,
          pmName: null,
          governingPartyId,
          coalitionId: null,
          coalitionPartyIds: null,
          totalSeatsSupporting: governingPartyId ? (seatsByParty[governingPartyId] ?? 0) : 0,
          majorityThreshold,
          seatsByParty,
          totalSeats,
          activeVoteId: null,
          noConfidenceCooldown: null,
          formedAt: null,
          formedTurn: null,
          collapsedAt: null,
          pmVacancyDeadlineTurn: currentTurn + PM_VACANCY_DEADLINE_TURNS,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }
}

// ---------------------------------------------------------------------------
// PM Appointment
// ---------------------------------------------------------------------------

/**
 * Appoint a character (player or NPP) as Prime Minister for the given country.
 * Clears any existing PM, assigns the new one, sends Discord notification.
 */
export async function appointPrimeMinister(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId | null,
  nppId: ObjectId | null | undefined,
  characterName: string,
  now: Date,
  preset?: string
): Promise<void> {
  const activePreset = preset ?? (await getGameState())?.preset;
  // Capture the outgoing head of government BEFORE any clears so we only
  // announce a genuinely new appointment. Re-appointing the sitting holder
  // (e.g. the same PM winning a fresh formation vote each turn) must not fire a
  // duplicate "New … Appointed" Discord notice — mirrors the confidence-motion
  // skip in the vote resolver. The caller updates pmCharacterId only after this
  // returns, so the stored value is still the outgoing PM here.
  const priorGov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  const priorPmCharacterId = priorGov?.pmCharacterId ?? null;
  const isSameHolder =
    characterId != null && priorPmCharacterId != null && priorPmCharacterId.equals(characterId);

  // Clear cabinet
  await clearCabinetOnTransition(db, countryId);
  await db.collection("ukCabinetCooldowns").deleteMany({ countryId });

  // Scope PM clear to this country — other countries may have their own PM
  const clearPM = { $set: { currentOffice: null, updatedAt: now } };
  const execKey = getExecutiveOfficeKey(countryId, activePreset);
  await Promise.all([
    db
      .collection<Character>("characters")
      .updateMany({ "currentOffice.type": execKey, countryId }, clearPM),
    db.collection<NPP>("npps").updateMany({ "currentOffice.type": execKey, countryId }, clearPM),
  ]);

  if (characterId) {
    // ── Leader confidence: install or renew on PM appointment ─────────────
    // Driven by config flag so any future country with an internal-party
    // confidence model opts in without a new country literal here.
    if (getCountryConfig(countryId, activePreset).hasLeaderConfidenceModel) {
      const gs = await db
        .collection<{ _id: string; currentTurn: number }>("gameState")
        .findOne({ _id: "current" });
      const currentTurn = gs?.currentTurn ?? 0;
      const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
      const existingPmId = gov?.pmCharacterId;
      if (existingPmId && existingPmId.equals(characterId)) {
        // Same leader renewing
        const char = await db
          .collection<Character>("characters")
          .findOne({ _id: characterId }, { projection: { party: 1 } });
        await renewLeaderMandate(
          db,
          countryId,
          characterId,
          execKey,
          char?.party ?? null,
          currentTurn
        );
      } else {
        // New leader
        const char = await db
          .collection<Character>("characters")
          .findOne({ _id: characterId }, { projection: { party: 1 } });
        await installNewLeader(
          db,
          countryId,
          characterId,
          execKey,
          char?.party ?? null,
          currentTurn
        );
      }
    }
    // ────────────────────────────────────────────────────────────────────

    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: characterId }, { projection: { party: 1, currentOffice: 1 } });
    const prev = char?.currentOffice;
    const pmOffice: OfficeType = {
      type: execKey,
      ...(prev && "state" in prev && typeof prev.state === "string"
        ? {
            state: prev.state,
            ...("constituency" in prev && prev.constituency != null
              ? { constituency: prev.constituency as string }
              : {}),
            ...("constituencyId" in prev && prev.constituencyId != null
              ? { constituencyId: prev.constituencyId as string }
              : {}),
          }
        : {}),
    };
    const pmCareer: CareerEvent = {
      type: "appointed",
      office: pmOffice,
      officeLabel: getOfficeLabel(pmOffice, countryId),
      date: now,
      ...(char?.party ? { party: char.party } : {}),
    };
    await db.collection<Character>("characters").updateOne(
      { _id: characterId },
      {
        $set: { currentOffice: pmOffice, updatedAt: now },
        $push: { careerHistory: pmCareer },
      }
    );
  } else if (nppId) {
    await db
      .collection<NPP>("npps")
      .updateOne({ _id: nppId }, { $set: { currentOffice: { type: execKey }, updatedAt: now } });
  }

  const config = getCountryConfig(countryId, activePreset);

  // Country history: record the head-of-government transition. Fetch PM's
  // party for the event (if a player character) — we don't already have it
  // in scope for the NPP branch above.
  await (async () => {
    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;
    let party: string | undefined;
    if (characterId) {
      const pmChar = await db
        .collection<Character>("characters")
        .findOne({ _id: characterId }, { projection: { party: 1 } });
      party = pmChar?.party;
    }
    await recordCountryEvent(
      db,
      {
        countryId,
        turn,
        eventType: "leader_change",
        title: `${characterName} sworn in as ${config.executiveTitle}`,
        officeType: execKey,
        characterId: characterId ?? undefined,
        characterName,
        party,
        details: {
          isNPP: characterId == null,
          nppId: nppId?.toString(),
        },
      },
      now
    );
  })().catch((err) => logger.error("countryHistory", "PM leader_change failed", err));

  // Only announce when the head of government actually changed — a same-holder
  // re-appointment (repeated formation vote, redeploy overlap) must not spam
  // "New … Appointed".
  if (!isSameHolder) {
    sendCountryGameEvent(countryId, {
      title: `New ${config.executiveTitle} Appointed`,
      description: `**${characterName}** has been appointed as ${config.executiveTitle} of ${config.name}.`,
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// NPP Auto-Aye
// ---------------------------------------------------------------------------

/**
 * Auto-cast NPP votes on PM appointment votes for qualifying party members.
 * Parameterized by countryId — queries officials from the country's lower chamber.
 */
export async function autoAyeNPPsForParliamentaryAppointment(
  db: Db,
  countryId: CountryId,
  voteId: ObjectId
): Promise<void> {
  const lowerOfficeType = getLowerChamberOfficeType(countryId);

  const votesColl = getPMAppointmentVotesCollection(db);
  const vote = await votesColl.findOne({ _id: voteId });
  if (!vote || vote.status !== "active") return;

  // Head-of-state appointment votes are a JOINT sitting — NPP deputies of
  // both chambers auto-aye, not just the lower chamber (RU Chairman of the
  // Presidium; spec §2.3).
  const voterOfficeTypes =
    vote.office === "headOfState" ? getJointSittingOfficeTypes(countryId) : [lowerOfficeType];

  const qualifyingPartyIds: Set<string> =
    vote.formationType === "coalition" && vote.coalitionPartyIds
      ? new Set(vote.coalitionPartyIds)
      : new Set([vote.nomineePartyId]);

  const whips = await db
    .collection("billWhips")
    .find({
      targetType: "pmAppointmentVote",
      targetId: voteId,
      // NPP confidence voting only considers NPP whips; character whips already wrote player votes directly.
      $or: [{ audience: "npp" }, { audience: { $exists: false } }],
    })
    .toArray();
  const whipByParty = new Map(
    (whips as unknown as Array<{ partyId: string; direction: "for" | "against" }>).map((w) => [
      w.partyId,
      w.direction,
    ])
  );

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: { $in: voterOfficeTypes }, countryId, isNPP: true })
    .toArray();

  for (const mp of officials) {
    if (!mp.nppId) continue;
    const nppKey = `npp_${mp.nppId.toString()}`;
    if (vote.votes[nppKey]) continue;

    const inQualifyingParty = mp.party ? qualifyingPartyIds.has(mp.party) : false;
    const whipDir = mp.party ? whipByParty.get(mp.party) : undefined;

    let voteChoice: "aye" | "nay" | null = null;
    if (whipDir) {
      voteChoice = whipDir === "for" ? "aye" : "nay";
    } else if (inQualifyingParty) {
      voteChoice = "aye";
    }
    if (voteChoice === null) continue;

    const weight = mp.seatsHeld ?? 1;
    // Filter on `votes.${nppKey}` not yet existing so concurrent auto-aye
    // passes (periodic + resolution + inline-resolve) can't double-count this
    // NPP's increment if they interleave between the in-memory skip check and
    // this write.
    await votesColl.updateOne(
      { _id: voteId, [`votes.${nppKey}`]: { $exists: false } },
      {
        $set: { [`votes.${nppKey}`]: voteChoice, updatedAt: new Date() },
        $inc: { [voteChoice === "aye" ? "votesFor" : "votesAgainst"]: weight },
      }
    );
  }
}

/**
 * Auto-cast NPP votes on an active no-confidence motion along the party line.
 *
 * Mirrors `autoAyeNPPsForParliamentaryAppointment`: same billWhips lookup, same
 * "never overwrite an existing vote" rule, same seat-weighted `$inc` guarded by
 * an `$exists: false` filter so concurrent passes cannot double-count.
 *
 * Direction on a confidence motion is the inverse of an appointment vote. "aye"
 * backs the MOTION, so it is a vote against the government:
 *   - governing party and coalition NPPs vote "nay" (they keep the government)
 *   - opposition NPPs vote "aye"
 *   - NPPs with no party abstain (no party means no party line)
 *
 * A party whip still wins. A whip issued before this pass is honoured here via
 * `billWhips`, and a whip issued afterwards overrides the default through
 * `applyWhipVotesToGovernmentVote`, which decrements the old vote before
 * writing the new one. Auto-voting is the floor, not a ceiling.
 *
 * Without this, NPP-held government benches cast nothing at all and a whipped
 * opposition bloc could carry a motion on its own (ticket-1137).
 */
export async function autoVoteNPPsForNoConfidence(
  db: Db,
  countryId: CountryId,
  voteId: ObjectId
): Promise<void> {
  const votesColl = getNoConfidenceVotesCollection(db);
  const vote = await votesColl.findOne({ _id: voteId });
  if (!vote || vote.status !== "active") return;

  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  const governingPartyIds = await resolveGoverningPartyIdsFromDocuments(
    db,
    countryId,
    govFormation,
    null
  );
  // No resolvable government means there is no party line to follow.
  if (governingPartyIds.size === 0) return;

  const whips = await db
    .collection("billWhips")
    .find({
      targetType: "noConfidenceVote",
      targetId: voteId,
      // NPP confidence voting only considers NPP whips; character whips already wrote player votes directly.
      $or: [{ audience: "npp" }, { audience: { $exists: false } }],
    })
    .toArray();
  const whipByParty = new Map(
    (whips as unknown as Array<{ partyId: string; direction: "for" | "against" }>).map((w) => [
      w.partyId,
      w.direction,
    ])
  );

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: getLowerChamberOfficeType(countryId), countryId, isNPP: true })
    .toArray();

  const existingVotes = vote.votes ?? {};
  const seenNppIds = new Set<string>();

  for (const mp of officials) {
    if (!mp.nppId) continue;
    const nppIdStr = mp.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);

    const nppKey = `npp_${nppIdStr}`;
    // A vote already on the record (player whip, earlier pass) is never touched.
    if (existingVotes[nppKey]) continue;
    if (!mp.party) continue;

    const whipDir = whipByParty.get(mp.party);
    const voteChoice: "aye" | "nay" = whipDir
      ? whipDir === "for"
        ? "aye"
        : "nay"
      : governingPartyIds.has(mp.party)
        ? "nay"
        : "aye";

    const weight = mp.seatsHeld ?? 1;
    await votesColl.updateOne(
      { _id: voteId, [`votes.${nppKey}`]: { $exists: false } },
      {
        $set: { [`votes.${nppKey}`]: voteChoice, updatedAt: new Date() },
        $inc: { [voteChoice === "aye" ? "votesFor" : "votesAgainst"]: weight },
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Vote Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an expired PM appointment vote for the given country.
 */
export async function resolveParliamentaryAppointmentVote(
  db: Db,
  countryId: CountryId,
  voteId: ObjectId,
  now: Date
): Promise<void> {
  const votesColl = getPMAppointmentVotesCollection(db);
  const govColl = getGovernmentFormationsCollection(db);

  // Final auto-aye pass
  await autoAyeNPPsForParliamentaryAppointment(db, countryId, voteId);

  const vote = await votesColl.findOne({ _id: voteId });
  if (!vote || vote.status !== "active") return;
  // Head-of-state votes resolve via resolveHeadOfStateAppointmentVote —
  // guard against direct callers routing one through the PM path.
  if (vote.office === "headOfState") return;

  // Decide from the seat-weighted recompute (single source of truth), not the
  // cached running counters — those drift as seats change and can include
  // de-seated voters. Reassign the in-memory fields so every downstream
  // notification / Discord line below quotes the reconciled totals.
  const tally = await computeParliamentaryGovernmentTally(
    db,
    countryId,
    getLowerChamberOfficeType(countryId),
    vote.votes
  );
  vote.votesFor = tally.votesFor;
  vote.votesAgainst = tally.votesAgainst;
  // Appointment votes need an aye majority to seat someone. A post-election
  // confidence motion is the inverse: the incumbent stays unless nays strictly
  // outnumber ayes. An empty or tied ballot must not unseat.
  const passed = vote.isConfidenceMotion
    ? vote.votesFor >= vote.votesAgainst
    : vote.votesFor > vote.votesAgainst;

  // Atomic claim: only the caller that flips status "active" → final runs the
  // side effects. Inline-resolve paths (see processParliamentaryGovernmentVotes
  // callers) and the turn processor can race; the loser returns early. Persist
  // the reconciled totals so the closed record matches the breakdown.
  const claimed = await votesColl.findOneAndUpdate(
    { _id: voteId, status: "active" },
    {
      $set: {
        status: passed ? "passed" : "failed",
        closedAt: now,
        updatedAt: now,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
      },
    }
  );
  if (!claimed) return;

  if (passed) {
    // A passed confidence motion's nominee is always the sitting PM (see
    // openConfidenceMotionForIncumbent) — nothing about the office actually
    // changed. Routing it through appointPrimeMinister clears the cabinet,
    // pushes a duplicate "appointed" career event, and fires a spurious
    // "New {Title} Appointed" Discord notice on top of the correct "Survives
    // Confidence Motion" one below, for a PM who never left office.
    if (!vote.isConfidenceMotion) {
      await appointPrimeMinister(
        db,
        countryId,
        vote.nomineeCharacterId,
        null,
        vote.nomineeName,
        now
      );
    }

    const gameState = await getGameState();

    // Recalculate totalSeatsSupporting from the coalition/party that won the vote
    const existing = await govColl.findOne({ _id: countryId });
    const currentSeats = existing?.seatsByParty ?? {};
    let totalSeatsSupporting: number;
    if (vote.coalitionPartyIds?.length) {
      totalSeatsSupporting = vote.coalitionPartyIds.reduce(
        (sum, pid) => sum + (currentSeats[pid] ?? 0),
        0
      );
    } else {
      totalSeatsSupporting = vote.nomineePartyId ? (currentSeats[vote.nomineePartyId] ?? 0) : 0;
    }

    await govColl.updateOne(
      { _id: countryId },
      {
        $set: {
          status: "formed",
          pmCharacterId: vote.nomineeCharacterId,
          pmName: vote.nomineeName,
          governingPartyId: vote.nomineePartyId,
          formationType: vote.formationType,
          coalitionId: vote.coalitionId,
          coalitionPartyIds: vote.coalitionPartyIds,
          totalSeatsSupporting,
          lostMajority: false,
          activeVoteId: null,
          updatedAt: now,
          // A confidence-motion survival is the same PM/government continuing,
          // not a new formation — don't restart the formation clock or reset
          // the snap-election allowance/vacancy watcher for an office that
          // never actually vacated.
          ...(vote.isConfidenceMotion
            ? {}
            : {
                formedAt: now,
                formedTurn: gameState?.currentTurn ?? null,
                snapElectionsUsed: 0,
                lastSnapElectionTurn: null,
                pmVacancyDeadlineTurn: null,
              }),
        },
      }
    );

    // Cancel all other active appointment votes — this country now has a government
    await votesColl.updateMany(
      { countryId, status: "active", _id: { $ne: voteId } },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    );

    await db.collection("ukCabinetCooldowns").deleteMany({ countryId });

    const nomineeChar = await db
      .collection<Character>("characters")
      .findOne({ _id: vote.nomineeCharacterId });
    if (nomineeChar?.userId) {
      const config = getCountryConfig(countryId);
      await createNotifications([
        {
          userId: nomineeChar.userId,
          title: `Appointed ${config.executiveTitle}`,
          message: `Your appointment as ${config.executiveTitle} has been confirmed (${vote.votesFor} ayes, ${vote.votesAgainst} nays).`,
          type: "system",
          metadata: { recipientCharacterId: vote.nomineeCharacterId.toString() },
        },
      ]);
    }

    const config = getCountryConfig(countryId);
    sendCountryGameEvent(countryId, {
      title: vote.isConfidenceMotion
        ? `${config.executiveTitle} Survives Confidence Motion`
        : "Government Formed",
      description: vote.isConfidenceMotion
        ? `**${vote.nomineeName}** has won the post-election confidence motion (${vote.votesFor} ayes, ${vote.votesAgainst} nays) and remains as ${config.executiveTitle}.`
        : `**${vote.nomineeName}** has been confirmed as ${config.executiveTitle} (${vote.votesFor}–${vote.votesAgainst}).`,
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  } else {
    await govColl.updateOne({ _id: countryId }, { $set: { activeVoteId: null, updatedAt: now } });

    // S#17: confidence motion failure semantics. If a failed confidence
    // motion has no alternative candidate whose appointment vote has
    // already passed, vacate the incumbent.
    if (vote.isConfidenceMotion) {
      const alternativePassed = await votesColl.findOne({
        countryId,
        status: "passed",
        _id: { $ne: voteId },
      });
      if (!alternativePassed) {
        await unformGovernmentAndVacatePM(db, countryId, now, {
          reason: "confidence-motion-failed",
        });
        const config = getCountryConfig(countryId);
        sendCountryGameEvent(countryId, {
          title: `${config.executiveTitle} Loses Confidence Motion`,
          description: `**${vote.nomineeName}** lost the post-election confidence motion (${vote.votesFor} ayes, ${vote.votesAgainst} nays) and has been removed from office.`,
          color: DISCORD_COLORS.govCollapsed,
          footer: { text: "A House Divided" },
          timestamp: now.toISOString(),
        }).catch(() => {});
      }
    }

    const nomineeChar = await db
      .collection<Character>("characters")
      .findOne({ _id: vote.nomineeCharacterId });
    if (nomineeChar?.userId) {
      const config = getCountryConfig(countryId);
      const title = vote.isConfidenceMotion
        ? `${config.executiveTitle} Confidence Motion Failed`
        : `${config.executiveTitle} Appointment Vote Failed`;
      const message = vote.isConfidenceMotion
        ? `You lost the confidence motion (${vote.votesFor} confidence, ${vote.votesAgainst} no confidence).`
        : `Your appointment as ${config.executiveTitle} was rejected (${vote.votesFor} ayes, ${vote.votesAgainst} nays).`;
      await createNotifications([
        {
          userId: nomineeChar.userId,
          title,
          message,
          type: "system",
        },
      ]);
    }
  }
}

/**
 * Does a no-confidence motion carry?
 *
 * A motion of no confidence removes a sitting government, so it must command a
 * majority of the WHOLE chamber, not a majority of whoever happened to turn up.
 * Abstentions and unvoted seats therefore count against the motion, which is
 * how a real confidence vote works: the government survives by default.
 *
 * Tallies are seat-weighted (see computeParliamentaryGovernmentTally), so
 * `votesFor` is directly comparable to the chamber's `majorityThreshold`.
 *
 * This is deliberately NOT the cloture rule (3/5 of votes CAST) used for
 * legislative debate, and it does not apply to any other vote type.
 *
 * Fallbacks, in order: the stored `majorityThreshold`, a threshold derived from
 * `totalSeats`, and finally a strict majority of votes cast when the formation
 * row carries neither number.
 */
export function noConfidenceMotionCarries(input: {
  votesFor: number;
  votesAgainst: number;
  majorityThreshold?: number | null;
  totalSeats?: number | null;
}): boolean {
  const { votesFor, votesAgainst, majorityThreshold, totalSeats } = input;
  const threshold =
    majorityThreshold != null && majorityThreshold > 0
      ? majorityThreshold
      : totalSeats != null && totalSeats > 0
        ? Math.floor(totalSeats / 2) + 1
        : null;
  if (threshold == null) {
    return votesFor > votesAgainst;
  }
  return votesFor >= threshold;
}

/**
 * Resolve an expired no-confidence vote for the given country.
 */
export async function resolveParliamentaryNoConfidenceVote(
  db: Db,
  countryId: CountryId,
  voteId: ObjectId,
  now: Date
): Promise<void> {
  const votesColl = getNoConfidenceVotesCollection(db);
  const govColl = getGovernmentFormationsCollection(db);

  // Final party-line pass: benches that were never whipped still vote, so a
  // government whose seats are NPP-held is not silently unseated (ticket-1137).
  await autoVoteNPPsForNoConfidence(db, countryId, voteId);

  const vote = await votesColl.findOne({ _id: voteId });
  if (!vote || vote.status !== "active") return;

  // Decide from the seat-weighted recompute (single source of truth) and
  // reassign the in-memory counters so downstream notifications quote the
  // reconciled totals.
  const tally = await computeParliamentaryGovernmentTally(
    db,
    countryId,
    getLowerChamberOfficeType(countryId),
    vote.votes
  );
  vote.votesFor = tally.votesFor;
  vote.votesAgainst = tally.votesAgainst;
  const govFormationForTally = await govColl.findOne({ _id: countryId });
  const passed = noConfidenceMotionCarries({
    votesFor: vote.votesFor,
    votesAgainst: vote.votesAgainst,
    majorityThreshold: govFormationForTally?.majorityThreshold,
    totalSeats: govFormationForTally?.totalSeats,
  });
  const notificationInputs: NotificationInput[] = [];

  // Atomic claim: only the caller that flips status "active" → final runs the
  // side effects. Inline-resolve paths (executive hub/API) and the turn
  // processor can race; the loser returns early. Persist reconciled totals.
  const claimed = await votesColl.findOneAndUpdate(
    { _id: voteId, status: "active" },
    {
      $set: {
        status: passed ? "passed" : "failed",
        closedAt: now,
        updatedAt: now,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
      },
    }
  );
  if (!claimed) return;

  if (passed) {
    // Helper handles status, pm fields, cabinet clear, currentOffice clear,
    // and re-arms the 96-turn vacancy clock. collapsedAt: now (from reason).
    await unformGovernmentAndVacatePM(db, countryId, now, { reason: "no-confidence" });

    // NC-specific recalcs: re-derive seat tally and governing party after the
    // vote. Not owned by the vacate helper (cycle-specific data).
    const seatsByParty = await tallySeatsByParty(db, countryId);
    const governingPartyId = getLargestParty(seatsByParty);
    await govColl.updateOne(
      { _id: countryId },
      { $set: { seatsByParty, governingPartyId, updatedAt: now } }
    );

    const pmChar = await db
      .collection<Character>("characters")
      .findOne({ _id: vote.targetPmCharacterId });
    if (pmChar?.userId) {
      notificationInputs.push({
        userId: pmChar.userId,
        title: "Removed from Office",
        message: `You have been removed as ${getCountryConfig(countryId).executiveTitle} by a vote of no confidence (${vote.votesFor} for, ${vote.votesAgainst} against).`,
        type: "system",
        metadata: { recipientCharacterId: vote.targetPmCharacterId.toString() },
      });
    }

    sendCountryGameEvent(countryId, {
      title: "Government Collapses — No Confidence Vote Passed",
      description: `A vote of no confidence has passed (${vote.votesFor}–${vote.votesAgainst}). The ${getCountryConfig(countryId).executiveTitle} has been removed from office.`,
      color: DISCORD_COLORS.govCollapsed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  } else {
    await govColl.updateOne({ _id: countryId }, { $set: { activeVoteId: null, updatedAt: now } });

    const noConfidenceThresholdSeats =
      govFormationForTally?.majorityThreshold != null && govFormationForTally.majorityThreshold > 0
        ? govFormationForTally.majorityThreshold
        : govFormationForTally?.totalSeats != null && govFormationForTally.totalSeats > 0
          ? Math.floor(govFormationForTally.totalSeats / 2) + 1
          : null;
    const noConfidenceThresholdText =
      noConfidenceThresholdSeats != null
        ? `${noConfidenceThresholdSeats} seats`
        : "a majority of the chamber";

    // S#17: VONC fails → the sitting PM survives. Cancel any PM appointment
    // votes that were filed during the VONC window (they're moot now).
    // Notify each nominee so they know why.
    const activeAppointments = await getPMAppointmentVotesCollection(db)
      .find({ countryId, status: "active" })
      .toArray();
    if (activeAppointments.length > 0) {
      await getPMAppointmentVotesCollection(db).updateMany(
        { countryId, status: "active" },
        { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
      );
      for (const appt of activeAppointments) {
        const nominee = await db
          .collection<Character>("characters")
          .findOne({ _id: appt.nomineeCharacterId });
        if (nominee?.userId) {
          notificationInputs.push({
            userId: nominee.userId,
            title: "PM Appointment Vote Cancelled",
            message:
              "Your PM appointment vote was cancelled because the vote of no confidence it was filed during failed.",
            type: "system",
          });
        }
      }
    }

    const pmChar = await db
      .collection<Character>("characters")
      .findOne({ _id: vote.targetPmCharacterId });
    if (pmChar?.userId) {
      notificationInputs.push({
        userId: pmChar.userId,
        title: "Survived No-Confidence Vote",
        message: `You survived the vote of no confidence (${vote.votesAgainst} confidence, ${vote.votesFor} no confidence). A motion needs ${noConfidenceThresholdText} to carry.`,
        type: "system",
        metadata: { recipientCharacterId: vote.targetPmCharacterId.toString() },
      });
    }
  }

  await createNotifications(notificationInputs);
}

// ---------------------------------------------------------------------------
// Turn Processing Entry Points
// ---------------------------------------------------------------------------

/**
 * Process expired votes for the given country.
 * Multiple appointment votes may be active concurrently — resolve all expired ones.
 * If one passes mid-loop, resolveParliamentaryAppointmentVote cancels the rest.
 * CRITICAL: filters by countryId to prevent cross-country vote processing.
 */
export async function processParliamentaryGovernmentVotes(
  db: Db,
  countryId: CountryId,
  now: Date,
  // The turn being processed. Turn-phase callers MUST pass the in-flight turn
  // (gameState.currentTurn is not bumped to newTurn until the turn finishes, so
  // reading it mid-turn is stale by one and resolves votes a turn late).
  // Render-path callers may omit it — at render time gameState.currentTurn is
  // already the last completed turn.
  currentTurnOverride?: number
): Promise<void> {
  let currentTurn = currentTurnOverride;
  if (currentTurn == null) {
    const gsForTurn = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" });
    currentTurn = gsForTurn?.currentTurn ?? 0;
  }

  // Filter the (tiny) active-vote set in memory with isVoteClosed — the same
  // null-safe close decision used by the command and whippable paths
  // (turn-based when closesOnTurn is set, closesAt fallback otherwise). Avoids
  // a $or query and the Mongo type friction of matching missing/null turns.

  // Resolve all expired appointment votes (multiple may be active concurrently)
  const activeAppointments = await getPMAppointmentVotesCollection(db)
    .find({ countryId, status: "active" })
    .toArray();
  const expiredAppointments = activeAppointments.filter((v) => isVoteClosed(v, currentTurn, now));

  for (const vote of expiredAppointments) {
    // If a prior vote in this loop passed and cancelled the rest, this vote's
    // status will have been set to "cancelled" — the resolvers re-read status
    // and skip cancelled votes.
    if (vote.office === "headOfState") {
      // Head-of-state appointment (RU Chairman of the Presidium) resolves
      // through its own path — joint-sitting tally, ceremonial seating,
      // no cabinet/confidence side effects. Dynamic import avoids a static
      // cycle (hosAppointment imports this module's auto-aye).
      const { resolveHeadOfStateAppointmentVote } = await import("@/lib/turn/hosAppointment");
      await resolveHeadOfStateAppointmentVote(db, countryId, vote._id, now);
    } else {
      await resolveParliamentaryAppointmentVote(db, countryId, vote._id, now);
    }
  }

  // No-confidence: still one at a time
  const activeNoConfidence = await getNoConfidenceVotesCollection(db).findOne({
    countryId,
    status: "active",
  });
  if (activeNoConfidence && isVoteClosed(activeNoConfidence, currentTurn, now)) {
    await resolveParliamentaryNoConfidenceVote(db, countryId, activeNoConfidence._id, now);
  }
}

/**
 * Every-4-turn NPP auto-vote pass for all active PM appointment votes, plus
 * the country's active no-confidence motion (party-line default).
 * Multiple appointment votes may be active concurrently.
 * CRITICAL: filters by countryId.
 */
export async function processParliamentaryNPPAutoAye(
  db: Db,
  countryId: CountryId,
  _now: Date,
  currentTurn: number
): Promise<void> {
  if (currentTurn % 4 !== 0) return;

  const activeVotes = await getPMAppointmentVotesCollection(db)
    .find({ countryId, status: "active" })
    .toArray();

  for (const vote of activeVotes) {
    await autoAyeNPPsForParliamentaryAppointment(db, countryId, vote._id);
  }

  // Same cadence for an active confidence motion, so the live tally shows the
  // benches as they stand instead of an empty chamber until resolution.
  const activeNoConfidence = await getNoConfidenceVotesCollection(db).findOne({
    countryId,
    status: "active",
  });
  if (activeNoConfidence) {
    await autoVoteNPPsForNoConfidence(db, countryId, activeNoConfidence._id);
  }
}

// ---------------------------------------------------------------------------
// Appointment Eligibility Check
// ---------------------------------------------------------------------------

/** Minimum fraction of lower-chamber seats required for a minority government.
 *  Tuned so UK Commons (650) requires ≥100 seats; JP House of Reps (465) requires ≥72. */
const MINORITY_SEAT_FRACTION = 0.1538;

export type AppointmentEligibility =
  | {
      eligible: true;
      formationType: "majority" | "coalition" | "minority";
      coalitionId: number | null;
      coalitionPartyIds: string[] | null;
      qualifyingPartyIds: number[];
    }
  | { eligible: false };

/**
 * Determine whether a character is eligible to nominate a Prime Minister.
 *
 * The character must be either a party chair or coalition chair. Their
 * party/coalition must meet the seat threshold for majority, coalition,
 * or minority government formation. At least one player-character MP
 * must exist in the qualifying parties.
 *
 * Seat counts are always computed live from electedOfficials to prevent
 * stale govFormation.seatsByParty from incorrectly blocking party chairs
 * whose seats moved mid-term (e.g. after a player switches parties).
 *
 * This is the single source of truth — used by the POST appoint route,
 * the executive API, and the UK/JP/DE executive hubs.
 */
export async function checkAppointmentEligibility(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId,
  majorityThreshold: number
): Promise<AppointmentEligibility> {
  // Runtime governmentType so a post-Stage-4 conversion immediately
  // changes the canFormGovernment ruling-party gate.
  const runtime = await getCountryState(db, countryId);
  const runtimeConfig = { governmentType: runtime.governmentType };
  const lowerOfficeType = getLowerChamberOfficeType(countryId);
  const liveLowerSeats = await getLiveLowerChamberSeats(db, countryId);
  const minorityThreshold = Math.ceil(liveLowerSeats * MINORITY_SEAT_FRACTION);

  // Always compute live to avoid stale stored seatsByParty when a player
  // switches parties mid-term and their seat moves to a new party.
  const seatsByParty = await tallySeatsByParty(db, countryId);

  // --- Check as party chair (or acting vice-chair when chair seat vacant) ---
  // Per the 2026-05-22 VC-acting-chair rule: the vice-chair inherits chair
  // authority — including PM-proposal eligibility — when the chair slot is
  // null. Match either the seated chair OR a VC whose chair seat is vacant.
  const chairParty = await db.collection<PoliticalParty>("politicalParties").findOne({
    countryId,
    $or: [{ chairId: characterId }, { chairId: null, viceChairId: characterId }],
  });

  if (chairParty) {
    const partySeats = seatsByParty[String(chairParty.sequentialId)] ?? 0;

    // One-party state guard: only the ruling party may form government.
    if (!canFormGovernment(runtimeConfig, chairParty)) {
      return { eligible: false };
    }

    // Minority bids are allowed even when another party/coalition holds a majority —
    // the chamber gets to vote the proposal down rather than the proposal being
    // suppressed at the eligibility gate.
    let formationType: "majority" | "minority" | null = null;
    if (partySeats >= majorityThreshold) {
      formationType = "majority";
    } else if (partySeats >= minorityThreshold) {
      formationType = "minority";
    }

    if (formationType) {
      const pcMpCount = await db.collection<ElectedOfficial>("electedOfficials").countDocuments({
        officeType: lowerOfficeType,
        countryId,
        party: String(chairParty.sequentialId),
        isNPP: { $ne: true },
      });
      if (pcMpCount > 0) {
        return {
          eligible: true,
          formationType,
          coalitionId: null,
          coalitionPartyIds: null,
          qualifyingPartyIds: [chairParty.sequentialId],
        };
      }
    }
  }

  // --- Check as coalition chair ---
  const chairCoalition = await db
    .collection<Coalition>("coalitions")
    .findOne({ countryId, chairCharacterId: characterId });

  if (chairCoalition) {
    // One-party state guard: coalitions are not allowed unless the lead
    // member is the ruling party. Load the lead party so the gate can
    // read its regimeStatus.
    const leadPartySeqId = chairCoalition.members[0]?.partySequentialId;
    const leadParty =
      leadPartySeqId !== undefined
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ countryId, sequentialId: leadPartySeqId })
        : null;
    if (!canFormGovernment(runtimeConfig, leadParty)) {
      return { eligible: false };
    }
    const memberPartyIds = chairCoalition.members.map((m) => m.partySequentialId);
    const coalitionSeats = memberPartyIds.reduce(
      (sum, pid) => sum + (seatsByParty[String(pid)] ?? 0),
      0
    );
    const coalitionPartySeqIds = memberPartyIds.map(String);

    let formationType: "coalition" | "minority" | null = null;
    if (coalitionSeats >= majorityThreshold) {
      formationType = "coalition";
    } else if (coalitionSeats >= minorityThreshold) {
      formationType = "minority";
    }

    if (formationType) {
      const pcMpCount = await db.collection<ElectedOfficial>("electedOfficials").countDocuments({
        officeType: lowerOfficeType,
        countryId,
        party: { $in: coalitionPartySeqIds },
        isNPP: { $ne: true },
      });
      if (pcMpCount > 0) {
        return {
          eligible: true,
          formationType,
          coalitionId: chairCoalition.sequentialId,
          coalitionPartyIds: coalitionPartySeqIds,
          qualifyingPartyIds: memberPartyIds,
        };
      }
    }
  }

  return { eligible: false };
}

// ---------------------------------------------------------------------------
// Dissolution slate-clearing helpers
// ---------------------------------------------------------------------------

/**
 * Clears the sitting PM, unforms the government, re-arms the 96-turn PM
 * vacancy clock, and scopes all cabinet / currentOffice clears to the
 * country. No-op if no governmentFormations record exists.
 *
 * `collapsedAt` is derived from `opts.reason`:
 *  - "post-election" → null (fresh cycle clears collapse context)
 *  - "snap" or "no-confidence" → now (gov just collapsed at this moment)
 *  - Override via `opts.collapsedAt` if a caller needs an explicit value.
 *
 * Does NOT touch `cycle`, `seatsByParty`, `governingPartyId`,
 * `majorityThreshold`, `totalSeats`, or `noConfidenceCooldown` — those are
 * cycle-specific concerns owned by `resetParliamentaryGovernmentAfterElection`.
 */
export async function unformGovernmentAndVacatePM(
  db: Db,
  countryId: CountryId,
  now: Date,
  opts?: {
    reason?: "snap" | "no-confidence" | "post-election" | "confidence-motion-failed";
    collapsedAt?: Date | null;
  }
): Promise<void> {
  const govCol = getGovernmentFormationsCollection(db);
  const existing = await govCol.findOne({ _id: countryId });
  if (!existing) return;

  const gs = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const currentTurn = gs?.currentTurn ?? 0;

  const reason = opts?.reason ?? "snap";
  const collapsedAt =
    opts?.collapsedAt !== undefined ? opts.collapsedAt : reason === "post-election" ? null : now;

  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        status: "pending",
        pmCharacterId: null,
        pmName: null,
        formationType: null,
        lostMajority: false,
        coalitionId: null,
        coalitionPartyIds: null,
        activeVoteId: null,
        collapsedAt,
        formedAt: null,
        formedTurn: null,
        updatedAt: now,
        // Always re-arm on vacate. Anchor-preserving semantics would break
        // the auto-snap loop (expired clock never re-armed → watcher fires
        // every turn). Matches existing NC-pass and reset-else-branch behavior.
        pmVacancyDeadlineTurn: currentTurn + PM_VACANCY_DEADLINE_TURNS,
      },
    }
  );

  await Promise.all([
    clearCabinetOnTransition(db, countryId),
    db.collection("ukCabinetCooldowns").deleteMany({ countryId }),
    // Extra cabinetMembers sweep catches any position not in the country's
    // position map (clearCabinetOnTransition is scoped to known positions).
    db.collection("cabinetMembers").deleteMany({ countryId }),
  ]);

  const clearPM = { $set: { currentOffice: null, updatedAt: now } };
  const execKeyVacate = getExecutiveOfficeKey(countryId);
  await Promise.all([
    db
      .collection<Character>("characters")
      .updateMany({ "currentOffice.type": execKeyVacate, countryId }, clearPM),
    db
      .collection<NPP>("npps")
      .updateMany({ "currentOffice.type": execKeyVacate, countryId }, clearPM),
  ]);
}

/**
 * Increments cycle, recalculates seatsByParty / governingPartyId from
 * current electedOfficials for the country's lower chamber. Does NOT touch
 * `pmCharacterId`, `status`, `cabinet`, vacancy clock, or cancel any
 * active votes. Used by `runPostElectionGovernmentPhases` when the S#17
 * confidence-motion flow leaves the PM seated pending the motion's
 * resolution.
 *
 * No-op if no governmentFormations record exists.
 */
export async function updateSeatCountsOnly(db: Db, countryId: CountryId, now: Date): Promise<void> {
  const govCol = getGovernmentFormationsCollection(db);
  const existing = await govCol.findOne({ _id: countryId });
  if (!existing) return;

  const seatsByParty = await tallySeatsByParty(db, countryId);
  const governingPartyId = getLargestParty(seatsByParty);
  const cycle = (existing.cycle ?? 0) + 1;

  await govCol.updateOne(
    { _id: countryId },
    { $set: { cycle, seatsByParty, governingPartyId, updatedAt: now } }
  );
}

/**
 * Auto-file a Confidence Motion for the incumbent PM after a lower-chamber
 * election resolves. Creates a pmAppointmentVotes doc with
 * `isConfidenceMotion: true`, nominee = current PM, 24h duration.
 *
 * Returns { opened: false, reason } and performs no mutation when:
 *  - No gov record exists or no sitting PM (reason: "no-incumbent")
 *  - Gov is not in "formed" status (reason: "gov-not-formed")
 *  - Incumbent is no longer a sitting MP of the lower chamber
 *    (reason: "incumbent-lost-seat")
 */
export async function openConfidenceMotionForIncumbent(
  db: Db,
  countryId: CountryId,
  now: Date
): Promise<{ opened: boolean; reason?: string; voteId?: ObjectId }> {
  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });

  if (!gov || !gov.pmCharacterId) {
    return { opened: false, reason: "no-incumbent" };
  }
  if (gov.status !== "formed") {
    return { opened: false, reason: "gov-not-formed" };
  }

  const existingMotion = await getPMAppointmentVotesCollection(db).findOne({
    countryId,
    status: "active",
    isConfidenceMotion: true,
  });
  if (existingMotion) {
    return { opened: false, reason: "already-active" };
  }

  const lowerOfficeType = getLowerChamberOfficeType(countryId);

  // Verify incumbent retained a seat in the newly-elected lower chamber.
  const official = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ characterId: gov.pmCharacterId, officeType: lowerOfficeType, countryId });
  if (!official) {
    return { opened: false, reason: "incumbent-lost-seat" };
  }

  const closesAt = new Date(now.getTime() + PM_VOTE_DURATION_HOURS * 3_600_000);
  const gsForTurn = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const closesOnTurn = (gsForTurn?.currentTurn ?? 0) + PM_VOTE_DURATION_HOURS;
  const voteId = new ObjectId();

  const voteDoc = {
    _id: voteId,
    countryId,
    nomineeCharacterId: gov.pmCharacterId,
    nomineeName: gov.pmName ?? "",
    nomineePartyId: gov.governingPartyId ?? official.party ?? "",
    nominatedByCharacterId: gov.pmCharacterId,
    formationType: gov.formationType ?? "majority",
    coalitionId: gov.coalitionId ?? null,
    coalitionPartyIds: gov.coalitionPartyIds ?? null,
    votesFor: 0,
    votesAgainst: 0,
    votes: {} as Record<string, "aye" | "nay">,
    isConfidenceMotion: true,
    status: "active" as const,
    openedAt: now,
    closesAt,
    closesOnTurn,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await getPMAppointmentVotesCollection(db).insertOne(voteDoc);

  const config = getCountryConfig(countryId);
  const chamberName = config.legislature.lowerChamber.shortName;
  const pmChar = await db.collection<Character>("characters").findOne({ _id: gov.pmCharacterId });
  if (pmChar?.userId) {
    await createNotifications([
      {
        userId: pmChar.userId,
        title: `${config.executiveTitle} Confidence Motion`,
        message: `A post-election confidence motion has opened. ${chamberName} members will vote over the next ${PM_VOTE_DURATION_HOURS} hours on whether you remain ${config.executiveTitle}.`,
        type: "system",
        metadata: { recipientCharacterId: gov.pmCharacterId.toString() },
      },
    ]);
  }
  sendCountryGameEvent(countryId, {
    title: `${config.executiveTitle} Confidence Motion Opened`,
    description: `A post-election confidence motion is underway for **${gov.pmName}**. ${chamberName} members have ${PM_VOTE_DURATION_HOURS} hours to vote.`,
    color: DISCORD_COLORS.govFormed,
    footer: { text: "A House Divided" },
    timestamp: now.toISOString(),
  }).catch(() => {});

  return { opened: true, voteId };
}

/**
 * Cancels every active VONC for the given country. Safe to call on countries
 * that never create VONC docs (e.g. US) — naturally no-ops. Returns count.
 */
export async function cancelActiveNoConfidenceVotes(
  db: Db,
  countryId: CountryId,
  now: Date
): Promise<number> {
  const result = await getNoConfidenceVotesCollection(db).updateMany(
    { countryId, status: "active" },
    { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
  );
  return result.modifiedCount;
}

/**
 * Non-terminal bill statuses that are cleared when the lower chamber
 * dissolves. Explicitly excludes `enrolled` and `cabinet_review` — those
 * are "past the lower chamber" and survive dissolution.
 *
 * Exported because `mergeCountry` composes its whole-country lapse list from
 * this one (plus the past-the-chamber statuses a COUNTRY dissolution also
 * overtakes) — one taxonomy, not two hand-maintained copies.
 */
export const LOWER_CHAMBER_FAIL_STATUSES: BillStatus[] = [
  "proposed",
  "active",
  "passed_origin",
  "active_other",
  "active_both",
  "override_shugiin",
  "veto_override",
  "vetoed",
];

/**
 * Fails in-progress bills whose `currentChamber` equals the country's
 * lower-chamber key. Bills currently in the upper chamber (US Senate,
 * UK Lords, JP Sangiin), in JP cabinet_review, or enrolled are preserved.
 * Returns number of bills failed.
 */
export async function failInProgressBills(
  db: Db,
  countryId: CountryId,
  now: Date
): Promise<number> {
  const lowerChamberKey = getCountryConfig(countryId).legislature.lowerChamber.key;
  if (!lowerChamberKey) return 0;

  const result = await db.collection("bills").updateMany(
    {
      countryId,
      currentChamber: lowerChamberKey,
      status: { $in: LOWER_CHAMBER_FAIL_STATUSES },
    },
    { $set: { status: "failed", failedAt: now, updatedAt: now } }
  );

  return result.modifiedCount;
}

// ---------------------------------------------------------------------------
// Utility: Get all parliamentary country IDs
// ---------------------------------------------------------------------------

/** Returns all active/beta/coming-soon parliamentary country IDs. */
export function getParliamentaryCountryIds(preset?: string): CountryId[] {
  return COUNTRY_ORDER.filter((id) => isParliamentarySystem(getCountryConfig(id, preset)));
}

/**
 * Mirror a formed government's `governingPartyId` onto
 * `countryState.rulingPartyId` so the country record reflects who governs.
 *
 * `governingPartyId` is the ruling party's sequentialId as a string;
 * `rulingPartyId` is the numeric sequentialId. Idempotent: only writes on a
 * `formed` government with a numeric governingPartyId, and only when the value
 * changed. Non-numeric ids ("independent") are skipped.
 *
 * Excludes one-party states: there `rulingPartyId` is authoritative and is
 * mutated by Stage-3 leadership flows, so driving it from governmentFormations
 * each turn would revert those legitimate changes. OPS is seeded from config.
 *
 * Runs every turn inside runParliamentaryGovernmentPhases, so existing worlds
 * self-heal on the next turn (no separate migration needed).
 */
export async function syncRulingPartyIdFromFormedGovernment(
  db: Db,
  countryId: CountryId
): Promise<void> {
  const runtime = await getCountryState(db, countryId);
  if (runtime.governmentType === "onePartyState") return;
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov || gov.status !== "formed") return;
  const seqId = Number(gov.governingPartyId);
  if (!Number.isInteger(seqId)) return; // skip "independent"/non-numeric
  if (runtime.rulingPartyId === seqId) return;
  await updateCountryState(db, countryId, { rulingPartyId: seqId });
}
