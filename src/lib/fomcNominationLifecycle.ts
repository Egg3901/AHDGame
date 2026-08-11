/**
 * FOMC Nomination Lifecycle
 *
 * Mirrors the cabinet nomination lifecycle (`cabinetNominationLifecycle.ts`),
 * scoped to central-bank committee seats. Called each turn:
 *   A. NPP senators cast party-line votes on active FOMC nominations.
 *   B. Expired nominations resolve: confirmed nominees are installed into the
 *      target seat on `centralBanks.fomcBoard`; rejected ones leave it untouched.
 *
 * Senate-only (no 25th-Amendment dual-chamber path). Reuses `nppCabinetVote`,
 * `computeCabinetNominationTally`, and `didPass` so confirmation behaves exactly
 * like a cabinet confirmation.
 */
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { didPass } from "@/lib/billLifecycleHelpers";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";
import { getGameState } from "@/lib/gameState";
import { nppCabinetVote } from "@/lib/cabinetNominationLifecycle";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, NPP, Character } from "@/lib/db/types";
import type { CentralBank, FomcNomination } from "@/lib/db/types/centralBank";

/** Resolve a player character's owning userId for notifications. */
async function nomineeUserId(
  db: Awaited<ReturnType<typeof getDb>>,
  characterId: ObjectId | null
): Promise<ObjectId | null> {
  if (!characterId) return null;
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { userId: 1 } });
  return char?.userId ?? null;
}

export interface FomcNominationLifecycleResult {
  nominationsProcessed: number;
  confirmed: number;
  rejected: number;
}

/** Cast catch-up NPP senator votes on one active nomination. */
async function castNppFomcVotes(
  db: Awaited<ReturnType<typeof getDb>>,
  nom: FomcNomination,
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  presidentParty: string | undefined
): Promise<void> {
  const existingVotes = nom.votes ?? {};
  let incFor = 0;
  let incAgainst = 0;
  let incAbstain = 0;
  const voteUpdates: Record<string, "for" | "against" | "abstain"> = {};
  const seen = new Set<string>();

  for (const official of nppOfficials) {
    if (official.officeType !== "senate" || !official.nppId) continue;
    const idStr = official.nppId.toString();
    if (seen.has(idStr)) continue;
    seen.add(idStr);
    const key = `npp_${idStr}`;
    if (existingVotes[key]) continue;

    const nppParty = nppMap.get(idStr)?.party ?? official.party;
    const vote = nppCabinetVote(nppParty, nom.nomineeParty, presidentParty);
    const weight = official.seatsHeld ?? 1;
    voteUpdates[key] = vote;
    if (vote === "for") incFor += weight;
    else if (vote === "against") incAgainst += weight;
    else incAbstain += weight;
  }

  if (Object.keys(voteUpdates).length === 0) return;

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(voteUpdates)) setFields[`votes.${k}`] = v;

  await db.collection<FomcNomination>("fomcNominations").updateOne(
    { _id: nom._id },
    {
      $set: setFields,
      $inc: { votesFor: incFor, votesAgainst: incAgainst, votesAbstain: incAbstain },
    }
  );
}

/** Install a confirmed nominee into the target seat on the bank's board. */
async function installConfirmedSeat(
  db: Awaited<ReturnType<typeof getDb>>,
  nom: FomcNomination,
  now: Date
): Promise<void> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: nom.bankId });
  if (!bank?.fomcBoard) return;

  const board = bank.fomcBoard.map((seat) => {
    if (seat.seatId !== nom.seatId) {
      // A new chair vacates the chair flag everywhere else.
      return nom.makeChair ? { ...seat, isChair: false } : seat;
    }
    return {
      ...seat,
      occupantType: nom.occupantType,
      characterId: nom.nomineeCharacterId,
      characterName: nom.occupantType === "player" ? nom.nomineeName : nom.nomineeName,
      nppId: nom.occupantType === "npp" ? nom.nomineeNppId : null,
      alignment: nom.alignment,
      isChair: nom.makeChair ? true : seat.isChair,
      appointedByPresidentId: nom.proposedByPresidentId,
      appointedAtTurn: bank.fomcTermStartedAtTurn ?? 0,
    };
  });

  const set: Record<string, unknown> = { fomcBoard: board, updatedAt: now };
  // Keep the single-chair mirror fields coherent when the chair seat changes.
  if (nom.makeChair) {
    set.chairAlignment = nom.alignment;
    if (nom.occupantType === "player") {
      set.chairMode = "character";
      set.chairCharacterId = nom.nomineeCharacterId;
      set.chairCharacterName = nom.nomineeName;
      set.chairNppId = null;
    } else {
      set.chairMode = "npp";
      set.chairNppId = nom.nomineeNppId;
    }
  }

  await db.collection<CentralBank>("centralBanks").updateOne({ _id: nom.bankId }, { $set: set });
}

export async function processFomcNominationLifecycle(
  now: Date
): Promise<FomcNominationLifecycleResult> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  const result: FomcNominationLifecycleResult = {
    nominationsProcessed: 0,
    confirmed: 0,
    rejected: 0,
  };

  // Per-country NPP-senator/president scope, cached so multiple nominations for
  // one country don't refetch the chamber within a single turn.
  interface CountryScope {
    officials: ElectedOfficial[];
    nppMap: Map<string, NPP>;
    presidentParty: string | undefined;
  }
  const scopeCache = new Map<CountryId, CountryScope>();
  async function scopeFor(countryId: CountryId): Promise<CountryScope> {
    const cached = scopeCache.get(countryId);
    if (cached) return cached;
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, officeType: "senate", isNPP: true, nppId: { $exists: true } })
      .toArray();
    const ids = officials
      .map((o) => o.nppId)
      .filter((id): id is ObjectId => id instanceof ObjectId);
    const rows = ids.length
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: ids } })
          .toArray()
      : [];
    const pres = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
    const scope: CountryScope = {
      officials,
      nppMap: new Map(rows.map((n) => [n._id.toString(), n])),
      presidentParty: pres?.party,
    };
    scopeCache.set(countryId, scope);
    return scope;
  }

  // ── A. Catch-up votes on active nominations ────────────────────────────────
  const active = await db
    .collection<FomcNomination>("fomcNominations")
    .find({ status: "active", votingEndsOnTurn: { $gt: currentTurn } })
    .toArray();
  for (const nom of active) {
    const scope = await scopeFor(nom.countryId);
    await castNppFomcVotes(db, nom, scope.officials, scope.nppMap, scope.presidentParty);
  }

  // ── B. Resolve expired nominations ─────────────────────────────────────────
  const expired = await db
    .collection<FomcNomination>("fomcNominations")
    .find({ status: "active", votingEndsOnTurn: { $lte: currentTurn } })
    .toArray();

  const notifications: NotificationInput[] = [];

  for (const nom of expired) {
    result.nominationsProcessed++;
    const reTally = await computeCabinetNominationTally(db, nom.countryId, nom.votes);
    const passed = didPass(reTally.votesFor, reTally.votesAgainst);
    const seatLabel = nom.makeChair ? "Fed Chair" : `FOMC seat ${nom.seatId}`;

    if (passed) {
      await installConfirmedSeat(db, nom, now);
      await db
        .collection<FomcNomination>("fomcNominations")
        .updateOne(
          { _id: nom._id },
          { $set: { status: "confirmed", confirmedAt: now, updatedAt: now } }
        );
      result.confirmed++;
      if (nom.occupantType === "player") {
        const userId = await nomineeUserId(db, nom.nomineeCharacterId);
        if (userId) {
          notifications.push({
            userId,
            type: "leadership_appointed",
            title: "Confirmed to the FOMC",
            message: `You were confirmed as ${seatLabel}.`,
          });
        }
      }
    } else {
      await db
        .collection<FomcNomination>("fomcNominations")
        .updateOne(
          { _id: nom._id },
          { $set: { status: "rejected", rejectedAt: now, updatedAt: now } }
        );
      result.rejected++;
      if (nom.occupantType === "player") {
        const userId = await nomineeUserId(db, nom.nomineeCharacterId);
        if (userId) {
          notifications.push({
            userId,
            type: "system",
            title: "FOMC nomination rejected",
            message: `The Senate did not confirm you as ${seatLabel}.`,
          });
        }
      }
    }
  }

  if (notifications.length > 0) await createNotifications(notifications);
  return result;
}
