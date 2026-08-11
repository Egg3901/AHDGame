/**
 * SCOTUS Nomination Lifecycle (#3598).
 *
 * Reuses the cabinet-nomination Senate-majority-vote lifecycle's machinery
 * as-is: `nppCabinetVote` (party-line auto-vote), `computeCabinetNominationTally`
 * (seat-weighted re-tally scoped to current Senate seats), and `didPass`
 * (votesFor > votesAgainst). Mirrors `processCabinetNominationLifecycle`'s
 * two-part turn shape:
 *  A. NPP senator votes on active nominations (party-line preference)
 *  B. Close expired votes and resolve confirmed/rejected
 *
 * The one genuine extension over cabinet nominations: a SCOTUS nominee may be
 * a generated NPP "legal scholar" as well as a player character (cabinet
 * nominations are player-character-only today) — see `nominateJustice.ts`.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { didPass } from "@/lib/billLifecycleHelpers";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";
import { nppCabinetVote } from "@/lib/cabinetNominationLifecycle";
import { getGameState } from "@/lib/gameState";
import type { ElectedOfficial, NPP, Character, PoliticalParty } from "@/lib/db/types";
import type { ScotusNomination, SupremeCourtSeat } from "@/lib/db/types/scotus";
import { loadNomineePersonalPositions } from "@/lib/scotus/nominateJustice";
import { computeJusticeIdeology } from "@/lib/scotus/ideology";
import { DIVERGENT_TENURE_FLOOR_TURNS } from "@/lib/scotus/tenure";
import { initialJusticeActionFields } from "@/lib/constants/justiceActions";

export interface ScotusNominationLifecycleResult {
  nominationsProcessed: number;
  confirmed: number;
  rejected: number;
}

interface NppPreload {
  nppOfficials: ElectedOfficial[];
  nppMap: Map<string, NPP>;
  presidentParty: string | undefined;
}

async function castNPPScotusVotes(
  db: Db,
  nomination: ScotusNomination,
  preload: NppPreload
): Promise<void> {
  if (preload.nppOfficials.length === 0) return;

  const existingVotes = nomination.votes ?? {};
  let incFor = 0,
    incAgainst = 0,
    incAbstain = 0;
  const voteUpdates: Record<string, "for" | "against" | "abstain"> = {};

  const seenNppIds = new Set<string>();
  for (const official of preload.nppOfficials) {
    if (!official.nppId || official.officeType !== "senate") continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);
    const nppKey = `npp_${nppIdStr}`;
    if (existingVotes[nppKey]) continue;

    const npp = preload.nppMap.get(nppIdStr);
    const nppParty = npp?.party ?? official.party;
    const vote = nppCabinetVote(nppParty, nomination.nomineeParty, preload.presidentParty);
    const weight = official.seatsHeld ?? 1;

    voteUpdates[nppKey] = vote;
    if (vote === "for") incFor += weight;
    else if (vote === "against") incAgainst += weight;
    else incAbstain += weight;
  }

  if (Object.keys(voteUpdates).length === 0) return;

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(voteUpdates)) {
    setFields[`votes.${k}`] = v;
  }

  await db.collection<ScotusNomination>("scotusNominations").updateOne(
    { _id: nomination._id },
    {
      $set: setFields,
      $inc: { votesFor: incFor, votesAgainst: incAgainst, votesAbstain: incAbstain },
    }
  );
}

async function seatConfirmedJustice(
  db: Db,
  nomination: ScotusNomination,
  now: Date,
  currentTurn: number
): Promise<void> {
  const personal = await loadNomineePersonalPositions(db, nomination);
  let economicLean: number | null = null;
  let socialLean: number | null = null;
  if (personal && nomination.nomineeParty) {
    const seqId = parseInt(nomination.nomineeParty, 10);
    const party = Number.isFinite(seqId)
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ sequentialId: seqId, countryId: nomination.countryId })
      : null;
    if (party) {
      const ideology = computeJusticeIdeology(personal, {
        economicPosition: party.economicPosition,
        socialPosition: party.socialPosition,
      });
      economicLean = ideology.economicLean;
      socialLean = ideology.socialLean;
    }
  }

  await db.collection<SupremeCourtSeat>("supremeCourtSeats").updateOne(
    { countryId: nomination.countryId, seatNumber: nomination.seatNumber },
    {
      $set: {
        justiceMode: nomination.nomineeMode,
        justiceCharacterId: nomination.nomineeCharacterId,
        justiceNppId: nomination.nomineeNppId,
        justiceName: nomination.nomineeName,
        justiceParty: nomination.nomineeParty ?? null,
        economicLean,
        socialLean,
        seatedAt: now,
        seatedAtTurn: currentTurn,
        // Filling a seat via nomination/confirmation only ever happens once the
        // scripted Original Roster succession has run out (see scotusTenureTurn) —
        // this is the Divergence Point by construction. Permanent once set.
        isDivergent: true,
        divergentHazardStartsTurn: currentTurn + DIVERGENT_TENURE_FLOOR_TURNS,
        ...initialJusticeActionFields(now),
        updatedAt: now,
      },
    }
  );
}

export async function processScotusNominationLifecycle(
  now: Date,
  db?: Db
): Promise<ScotusNominationLifecycleResult> {
  const database = db ?? (await getDb());
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;

  const [nppOfficials, president] = await Promise.all([
    database
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: "senate",
        isNPP: true,
        nppId: { $exists: true },
      })
      .toArray(),
    database
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "president", characterId: { $ne: null } }),
  ]);
  const nppIds = nppOfficials
    .map((o) => o.nppId)
    .filter((id): id is ObjectId => id instanceof ObjectId);
  const npps = nppIds.length
    ? await database
        .collection<NPP>("npps")
        .find({ _id: { $in: nppIds } })
        .toArray()
    : [];
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
  const preload: NppPreload = { nppOfficials, nppMap, presidentParty: president?.party };

  const activeNominations = await database
    .collection<ScotusNomination>("scotusNominations")
    .find({
      status: "active",
      $or: [
        { votingEndsOnTurn: { $gt: currentTurn } },
        { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $gt: now } },
      ],
    })
    .toArray();

  for (const nom of activeNominations) {
    await castNPPScotusVotes(database, nom, preload);
  }

  const expired = await database
    .collection<ScotusNomination>("scotusNominations")
    .find({
      status: "active",
      $or: [
        { votingEndsOnTurn: { $lte: currentTurn } },
        { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $lte: now } },
      ],
    })
    .toArray();

  const notificationInputs: NotificationInput[] = [];
  let confirmed = 0;
  let rejected = 0;

  for (const nom of expired) {
    const reTally = await computeCabinetNominationTally(database, nom.countryId, nom.votes);
    const passed = didPass(reTally.votesFor, reTally.votesAgainst);

    if (passed) {
      await seatConfirmedJustice(database, nom, now, currentTurn);
      await database.collection<ScotusNomination>("scotusNominations").updateOne(
        { _id: nom._id },
        {
          $set: {
            status: "confirmed",
            confirmedAt: now,
            updatedAt: now,
            votesFor: reTally.votesFor,
            votesAgainst: reTally.votesAgainst,
            votesAbstain: reTally.votesAbstain,
          },
        }
      );
      confirmed++;

      const presidentChar = await database
        .collection<Character>("characters")
        .findOne({ _id: nom.proposedByPresidentId });
      if (presidentChar?.userId) {
        notificationInputs.push({
          userId: presidentChar.userId,
          type: "system",
          title: "Justice Confirmed",
          message: `${nom.nomineeName} was confirmed to Supreme Court seat #${nom.seatNumber}.`,
          metadata: {
            nominationId: nom._id.toString(),
            type: "scotus_confirmed",
            recipientCharacterId: presidentChar._id.toString(),
          },
        });
      }
      if (nom.nomineeMode === "character" && nom.nomineeCharacterId) {
        const nomineeChar = await database
          .collection<Character>("characters")
          .findOne({ _id: nom.nomineeCharacterId });
        if (nomineeChar?.userId && !nomineeChar._id.equals(nom.proposedByPresidentId)) {
          notificationInputs.push({
            userId: nomineeChar.userId,
            type: "system",
            title: "Justice Confirmed",
            message: `You were confirmed to Supreme Court seat #${nom.seatNumber}.`,
            metadata: {
              nominationId: nom._id.toString(),
              type: "scotus_confirmed",
              recipientCharacterId: nomineeChar._id.toString(),
            },
          });
        }
      }
    } else {
      await database.collection<ScotusNomination>("scotusNominations").updateOne(
        { _id: nom._id },
        {
          $set: {
            status: "rejected",
            rejectedAt: now,
            updatedAt: now,
            votesFor: reTally.votesFor,
            votesAgainst: reTally.votesAgainst,
            votesAbstain: reTally.votesAbstain,
          },
        }
      );
      rejected++;

      const presidentChar = await database
        .collection<Character>("characters")
        .findOne({ _id: nom.proposedByPresidentId });
      if (presidentChar?.userId) {
        notificationInputs.push({
          userId: presidentChar.userId,
          type: "system",
          title: "Justice Nomination Rejected",
          message: `${nom.nomineeName} was not confirmed for Supreme Court seat #${nom.seatNumber}.`,
          metadata: {
            nominationId: nom._id.toString(),
            type: "scotus_rejected",
            recipientCharacterId: presidentChar._id.toString(),
          },
        });
      }
    }
  }

  await createNotifications(notificationInputs);

  return {
    nominationsProcessed: activeNominations.length + expired.length,
    confirmed,
    rejected,
  };
}
