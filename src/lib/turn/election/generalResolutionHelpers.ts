import type { Db } from "mongodb";
import type {
  Election,
  ElectionStatus,
  ElectionVoteTally,
  ElectedOfficial,
  NPP,
  OfficeType,
  Character,
} from "@/lib/db/types";
import { MULTI_SEAT_TYPES, officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { triggerLeadershipElectionsAfterChamberVote } from "@/lib/congress/leadershipElections";
import { spawnHouseElection, spawnCommonsElection } from "@/lib/turn/election/electionSpawning";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { isExecutiveOffice } from "@/lib/elections/executiveOffice";
import type { ElectionNewsOutcome } from "./electionNotifications";
import { voidDebateSessionsForElection } from "@/lib/debate/debateSessionLifecycle";

export interface OneElectionResult {
  resolved: boolean;
  newsOutcomes: ElectionNewsOutcome[];
}

/** Flatten tally.primaryResults.byParty into candidateId → sharePct (won nominees). */
export function buildPrimaryShareMap(
  primaryResults: {
    byParty: Record<string, { candidateId: string; sharePct: number; won: boolean }[]>;
  } | null
): Record<string, number> | null {
  if (!primaryResults?.byParty) return null;
  const out: Record<string, number> = {};
  for (const entries of Object.values(primaryResults.byParty)) {
    for (const e of entries) {
      if (e.won) out[e.candidateId] = e.sharePct;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Chamber class to scope by when the election is a class-staggered multi-seat race. */
export function getChamberClass(election: Election): 1 | 2 | undefined {
  if (election.electionType !== "sangiin") return undefined;
  return election.chamberClass;
}

/** Filter for clearing/reading electedOfficials for a multi-seat race, scoped by chamberClass when present.
 *  Snap elections resolve to the SAME office as their regular counterpart — a snap_commons
 *  winner holds officeType "commons", so the filter must query the regular key to catch
 *  pre-snap officials who need sweeping. */
export function multiSeatOfficialFilter(election: Election): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    officeType: officeKeyForElectionType(election.electionType, election.countryId),
    state: election.state,
  };
  const cls = getChamberClass(election);
  if (cls) filter.chamberClass = cls;
  return filter;
}

export function carryForwardCommonsConstituency(
  nextOffice: OfficeType,
  previousOffice: OfficeType | null
): OfficeType {
  if (
    nextOffice.type !== "commons" ||
    !previousOffice ||
    previousOffice.type !== "commons" ||
    !("state" in previousOffice) ||
    !("state" in nextOffice) ||
    previousOffice.state !== nextOffice.state ||
    !("constituency" in previousOffice) ||
    !previousOffice.constituency
  ) {
    return nextOffice;
  }

  return {
    ...nextOffice,
    constituency: previousOffice.constituency,
    ...("constituencyId" in previousOffice && previousOffice.constituencyId
      ? { constituencyId: previousOffice.constituencyId }
      : {}),
  };
}

/**
 * When a sitting national executive wins a legislative/regional election,
 * preserve their executive currentOffice rather than overwriting it with the
 * lower office. Update state/constituency from the new seat so the executive's
 * linked constituency stays current. This keeps heads of government (PM,
 * Chancellor, Taoiseach, Premier, President) able to act on crises and other
 * executive mechanics after winning their legislative seat.
 */
export function preserveExecutiveOffice(
  nextOffice: OfficeType,
  previousOffice: OfficeType | null
): OfficeType {
  if (!previousOffice || !isExecutiveOffice(previousOffice)) {
    return nextOffice;
  }
  const preserved: Record<string, unknown> = {
    type: previousOffice.type,
  };
  if ("state" in nextOffice && typeof nextOffice.state === "string") {
    preserved.state = nextOffice.state;
  }
  if ("positionId" in previousOffice && typeof previousOffice.positionId === "string") {
    preserved.positionId = previousOffice.positionId;
  }
  if ("constituency" in nextOffice && nextOffice.constituency) {
    preserved.constituency = nextOffice.constituency;
  }
  if ("constituencyId" in nextOffice && nextOffice.constituencyId) {
    preserved.constituencyId = nextOffice.constituencyId;
  }
  return preserved as OfficeType;
}

/**
 * After a multi-seat constituency election resolves, clear currentOffice on any
 * character/NPP who claims that state but is no longer in electedOfficials.
 * Handles both candidates who lost and incumbents who didn't enter the race.
 * Works for commons, shugiin, sangiin, and any other multi-seat election type.
 *
 * For class-staggered chambers (JP Sangiin), scope by chamberClass so resolving
 * one class doesn't vacate officials who hold the other class's seats.
 */
export async function sweepStaleOffice(
  db: Db,
  electionType: string,
  state: string,
  now: Date,
  chamberClass?: 1 | 2
): Promise<void> {
  // Normalize snap types — a snap_commons election sweeps "commons" officials.
  const officeType = officeKeyForElectionType(electionType);
  const officialFilter: Record<string, unknown> = { officeType, state };
  if (chamberClass) officialFilter.chamberClass = chamberClass;

  const current = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(officialFilter, { projection: { characterId: 1, nppId: 1 } })
    .toArray();

  const currentCharIds = current
    .filter((o: ElectedOfficial) => o.characterId)
    .map((o: ElectedOfficial) => o.characterId!);
  const currentNppIds = current
    .filter((o: ElectedOfficial) => o.nppId)
    .map((o: ElectedOfficial) => o.nppId!);

  const officeMatch: Record<string, unknown> = {
    "currentOffice.type": officeType,
    "currentOffice.state": state,
  };
  if (chamberClass) officeMatch["currentOffice.chamberClass"] = chamberClass;

  await db.collection<Character>("characters").updateMany(
    {
      ...officeMatch,
      ...(currentCharIds.length > 0 ? { _id: { $nin: currentCharIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );

  await db.collection<NPP>("npps").updateMany(
    {
      ...officeMatch,
      ...(currentNppIds.length > 0 ? { _id: { $nin: currentNppIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );
}

/**
 * Empty-race handler: election completed but no tally document exists (no
 * votes were recorded). For multi-seat elections, clear stale officials so
 * the previous cycle's winners don't persist, and open the next race.
 * Extracted verbatim from resolveOneGeneralElection's `!tally` branch.
 */
export async function resolveElectionWithNoTally(
  db: Db,
  election: Election,
  now: Date
): Promise<OneElectionResult> {
  if (MULTI_SEAT_TYPES.has(election.electionType) && election.state) {
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany(multiSeatOfficialFilter(election));
    await sweepStaleOffice(
      db,
      election.electionType,
      election.state,
      now,
      getChamberClass(election)
    );
  }
  // Clear single-seat incumbent when election resolves with no tally
  if (["governor", "senate"].includes(election.electionType) && election.state) {
    const incumbentFilter: Record<string, unknown> = {
      officeType: election.electionType,
      state: election.state,
    };
    if (election.electionType === "senate" && election.senateClass) {
      incumbentFilter.senateClass = election.senateClass;
    }
    const incumbent = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne(incumbentFilter);
    if (incumbent) {
      const officeFilter: Record<string, unknown> = {
        "currentOffice.type": election.electionType,
        "currentOffice.state": election.state,
      };
      if (election.electionType === "senate" && election.senateClass) {
        officeFilter["currentOffice.senateClass"] = election.senateClass;
      }
      if (incumbent.characterId) {
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: incumbent.characterId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      if (incumbent.nppId) {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: incumbent.nppId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      await db.collection<ElectedOfficial>("electedOfficials").deleteOne({ _id: incumbent._id });
      if (election.electionType === "senate") {
        await notifyGovernorOfSenateVacancy(db, election.state, election.senateClass);
      }
      console.log(
        `[Turn] Vacated ${election.electionType} seat ` +
          `(${election.state}${election.senateClass ? ` Class ${election.senateClass}` : ""}) — election resolved with no tally`
      );
    }
  }
  // Spawn next cycle for election types with dedicated respawn functions
  if (election.electionType === "house") {
    await spawnHouseElection(db, election, now);
    await triggerLeadershipElectionsAfterChamberVote(db, "house", now);
  }
  if (election.electionType === "senate") {
    await triggerLeadershipElectionsAfterChamberVote(db, "senate", now);
  }
  if (election.electionType === "commons" && election.state) {
    await spawnCommonsElection(db, election, now);
  }
  await db
    .collection<Election>("elections")
    .updateOne(
      { _id: election._id },
      { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
    );
  await voidDebateSessionsForElection(db, election._id, now);
  return { resolved: false, newsOutcomes: [] };
}

/**
 * Empty-race handler: a tally exists but zero votes were cast. Extracted
 * verbatim from resolveOneGeneralElection's `totalVotesCast === 0` branch.
 */
export async function resolveElectionWithZeroVotes(
  db: Db,
  election: Election,
  now: Date
): Promise<OneElectionResult> {
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne({ electionId: election._id }, { $set: { finalized: true, updatedAt: now } });
  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  if (election.electionType === "house") {
    await spawnHouseElection(db, election, now);
    await triggerLeadershipElectionsAfterChamberVote(db, "house", now);
  }
  if (election.electionType === "senate") {
    await triggerLeadershipElectionsAfterChamberVote(db, "senate", now);
  }
  // Clear stale officials for any multi-seat election type
  if (MULTI_SEAT_TYPES.has(election.electionType) && election.state) {
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany(multiSeatOfficialFilter(election));
    await sweepStaleOffice(
      db,
      election.electionType,
      election.state,
      now,
      getChamberClass(election)
    );
  }
  // Clear single-seat incumbent when election resolves with zero votes cast
  if (["governor", "senate"].includes(election.electionType) && election.state) {
    const incumbentFilter: Record<string, unknown> = {
      officeType: election.electionType,
      state: election.state,
    };
    if (election.electionType === "senate" && election.senateClass) {
      incumbentFilter.senateClass = election.senateClass;
    }
    const incumbent = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne(incumbentFilter);
    if (incumbent) {
      const officeFilter: Record<string, unknown> = {
        "currentOffice.type": election.electionType,
        "currentOffice.state": election.state,
      };
      if (election.electionType === "senate" && election.senateClass) {
        officeFilter["currentOffice.senateClass"] = election.senateClass;
      }
      if (incumbent.characterId) {
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: incumbent.characterId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      if (incumbent.nppId) {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: incumbent.nppId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      await db.collection<ElectedOfficial>("electedOfficials").deleteOne({ _id: incumbent._id });
      if (election.electionType === "senate") {
        await notifyGovernorOfSenateVacancy(db, election.state, election.senateClass);
      }
      console.log(
        `[Turn] Vacated ${election.electionType} seat ` +
          `(${election.state}${election.senateClass ? ` Class ${election.senateClass}` : ""}) — election resolved with zero votes cast`
      );
    }
  }
  // Spawn next cycle for election types with dedicated respawn functions
  if (election.electionType === "commons" && election.state) {
    await spawnCommonsElection(db, election, now);
  }
  await db
    .collection<Election>("elections")
    .updateOne(
      { _id: election._id },
      { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
    );
  await voidDebateSessionsForElection(db, election._id, now);
  return { resolved: true, newsOutcomes: [] };
}

/**
 * Empty-race handler: votes existed but every ranked candidate was dropped
 * (missing candidate docs / deleted characters). Extracted verbatim from
 * resolveOneGeneralElection's `ranked.length === 0` branch.
 */
export async function resolveElectionWithNoRankedCandidates(
  db: Db,
  election: Election,
  now: Date
): Promise<OneElectionResult> {
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne({ electionId: election._id }, { $set: { finalized: true, updatedAt: now } });
  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  if (election.electionType === "house") {
    await spawnHouseElection(db, election, now);
    await triggerLeadershipElectionsAfterChamberVote(db, "house", now);
  }
  if (election.electionType === "senate") {
    await triggerLeadershipElectionsAfterChamberVote(db, "senate", now);
  }
  // Clear stale officials for any multi-seat election type
  if (MULTI_SEAT_TYPES.has(election.electionType) && election.state) {
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany(multiSeatOfficialFilter(election));
    await sweepStaleOffice(
      db,
      election.electionType,
      election.state,
      now,
      getChamberClass(election)
    );
  }
  if (election.electionType === "commons" && election.state) {
    await spawnCommonsElection(db, election, now);
  }
  // Clear single-seat incumbent when election resolves with no ranked candidates
  if (["governor", "senate"].includes(election.electionType) && election.state) {
    const incumbentFilter: Record<string, unknown> = {
      officeType: election.electionType,
      state: election.state,
    };
    if (election.electionType === "senate" && election.senateClass) {
      incumbentFilter.senateClass = election.senateClass;
    }
    const incumbent = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne(incumbentFilter);
    if (incumbent) {
      const officeFilter: Record<string, unknown> = {
        "currentOffice.type": election.electionType,
        "currentOffice.state": election.state,
      };
      if (election.electionType === "senate" && election.senateClass) {
        officeFilter["currentOffice.senateClass"] = election.senateClass;
      }
      if (incumbent.characterId) {
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: incumbent.characterId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      if (incumbent.nppId) {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: incumbent.nppId, ...officeFilter },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      }
      await db.collection<ElectedOfficial>("electedOfficials").deleteOne({ _id: incumbent._id });
      if (election.electionType === "senate") {
        await notifyGovernorOfSenateVacancy(db, election.state, election.senateClass);
      }
      console.log(
        `[Turn] Vacated ${election.electionType} seat ` +
          `(${election.state}${election.senateClass ? ` Class ${election.senateClass}` : ""}) — election resolved with no ranked candidates`
      );
    }
  }
  await db
    .collection<Election>("elections")
    .updateOne(
      { _id: election._id },
      { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
    );
  await voidDebateSessionsForElection(db, election._id, now);
  return { resolved: true, newsOutcomes: [] };
}
