/**
 * SCOTUS Tenure Turn (#3598).
 *
 * Two independent clocks, one per seat state:
 *
 *  - Original Roster seats (`isDivergent === false`): the justice seated at
 *    the preset's start leaves on their authored historical date. That opens
 *    a real vacancy for the in-game President and Senate. Later historical
 *    occupants are reference data only; the game must never appoint them
 *    automatically over the players' constitutional choice (ticket #1289).
 *
 *  - Divergent seats (`isDivergent === true`): flat per-turn hazard clock
 *    (`rollDivergentDeparture`), age-agnostic, uncapped on the high end.
 *    Applies to player-held seats as well as generated NPPs; otherwise a
 *    confirmed player stays on the Court forever (ticket #1135). The
 *    occupant and president are notified when the seat opens, and the UI
 *    shows the death chance while they sit.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { yearToTurn } from "@/lib/scotus/turnConversion";
import { calendarTurn } from "@/lib/utils/gameDate";
import { rollDivergentDeparture } from "@/lib/scotus/tenure";
import { generateScotusVacancyNews } from "@/lib/scotus/scotusNews";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export interface ScotusTenureTurnResult {
  seatsAdvanced: number;
  seatsVacatedByHistory: number;
  seatsVacatedByHazard: number;
}

function playerHoldsSeat(seat: SupremeCourtSeat): boolean {
  return seat.justiceCharacterId != null;
}

function vacatedOccupantFields(now: Date) {
  return {
    justiceMode: null,
    justiceCharacterId: null,
    justiceNppId: null,
    justiceName: null,
    justiceParty: null,
    economicLean: null,
    socialLean: null,
    seatedAt: null,
    seatedAtTurn: null,
    divergentHazardStartsTurn: null,
    updatedAt: now,
  };
}

/**
 * Vacate a seat only if it is still occupied the way we read it, reporting
 * whether this call is the one that made the transition.
 *
 * Two turn processors can overlap during a rolling deploy — each `find()`s the
 * seats before either writes — so an unconditional `$set` would let both post
 * the vacancy wire for the same departure. Matching on `justiceMode` makes the
 * transition its own referee: the winner's `$set` nulls it, so the loser matches
 * nothing and stays quiet. `updatedAt` always changes, so a matched seat is
 * always a modified one.
 */
async function vacateSeatIfStillOccupied(
  db: Db,
  seat: SupremeCourtSeat,
  now: Date
): Promise<boolean> {
  const result = await db
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .updateOne(
      { _id: seat._id, justiceMode: seat.justiceMode },
      { $set: vacatedOccupantFields(now) }
    );
  return (result?.modifiedCount ?? 0) > 0;
}

async function notifySeatVacated(
  db: Db,
  seat: SupremeCourtSeat,
  notifications: NotificationInput[],
  cause: "death" | "history"
): Promise<void> {
  try {
    const notifiedUserIds = new Set<string>();
    const justiceLabel = seat.justiceName?.trim() || "A justice";

    if (seat.justiceCharacterId) {
      const occupant = await db
        .collection<Character>("characters")
        .findOne({ _id: seat.justiceCharacterId }, { projection: { userId: 1 } });
      if (occupant?.userId) {
        notifiedUserIds.add(occupant.userId.toString());
        notifications.push({
          userId: occupant.userId,
          type: "system",
          title: cause === "death" ? "Died in office" : "Left the Supreme Court",
          message:
            cause === "death"
              ? `You died while serving as a Justice. Supreme Court seat #${seat.seatNumber} is now vacant.`
              : `Your tenure on Supreme Court seat #${seat.seatNumber} has ended. The seat is now vacant.`,
          metadata: {
            type: "scotus_vacated",
            seatNumber: seat.seatNumber,
            recipientCharacterId: seat.justiceCharacterId.toString(),
          },
        });
      }
    }

    const presidentOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      countryId: seat.countryId,
      officeType: "president",
      characterId: { $ne: null },
    });
    if (presidentOfficial?.characterId) {
      const presidentChar = await db
        .collection<Character>("characters")
        .findOne({ _id: presidentOfficial.characterId }, { projection: { userId: 1 } });
      if (presidentChar?.userId && !notifiedUserIds.has(presidentChar.userId.toString())) {
        const left =
          cause === "death"
            ? `${justiceLabel} has died in office`
            : `${justiceLabel} has left the Court`;
        notifications.push({
          userId: presidentChar.userId,
          type: "system",
          title: "Supreme Court vacancy",
          message: `${left}. Seat #${seat.seatNumber} is vacant. You may nominate a replacement.`,
          metadata: {
            type: "scotus_vacancy",
            seatNumber: seat.seatNumber,
            recipientCharacterId: presidentOfficial.characterId.toString(),
          },
        });
      }
    }

    await generateScotusVacancyNews({
      seatNumber: seat.seatNumber,
      justiceName: seat.justiceName,
      cause,
    }).catch((err) =>
      console.error(`[scotusTenureTurn] vacancy news failed for seat #${seat.seatNumber}:`, err)
    );
  } catch (err) {
    console.error(`[scotusTenureTurn] vacancy notify failed for seat #${seat.seatNumber}:`, err);
  }
}

export async function processScotusTenureTurn(
  currentTurn: number,
  db?: Db
): Promise<ScotusTenureTurnResult> {
  const database = db ?? (await getDb());
  const gameState = await getGameState();
  const startingYear =
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET);
  // Scripted departures are CALENDAR dates, so they resolve against the calendar
  // turn — a founding phase shifts the raw turn a full game year ahead of the
  // year the player sees (#1208). The divergent-seat hazard below stays on the
  // raw turn: it measures turns SERVED, a duration, not a date.
  const calTurn = calendarTurn(currentTurn, {
    preIterationActive: gameState?.preIteration?.active,
    preIterationTurns: gameState?.preIterationTurns,
  });

  const seats = await database
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ countryId: "US" })
    .toArray();

  const seatsAdvanced = 0;
  let seatsVacatedByHistory = 0;
  let seatsVacatedByHazard = 0;
  const now = new Date();
  const notifications: NotificationInput[] = [];

  for (const seat of seats) {
    if (!seat.isDivergent) {
      // Do not replay Original Roster succession over a living player who
      // somehow occupies a still-historical seat.
      if (playerHoldsSeat(seat)) continue;

      // A scripted departure fires exactly once, and `justiceMode` is what says
      // whether it already has: `vacatedOccupantFields` nulls it, and only the
      // preset seed and the confirmation flow ever set it. The seat keeps
      // pointing at the departed occupant, whose departure year is in the past
      // for good, so without this the same departure re-vacates the seat and
      // re-wires the vacancy post every turn, forever.
      //
      // Tested for "historical" rather than non-null to match the occupancy
      // predicate the rest of the module uses (`nominateJustice`, `queries`,
      // `scotusDocketTurn`, `scotusSurpriseCaseTurn`): an Original Roster seat's
      // only legitimate occupant is a scripted one, so a non-divergent seat
      // carrying a character/npp mode is malformed and must not be handed to the
      // historical clock.
      if (seat.justiceMode !== "historical") continue;

      const occupant = seat.historicalOccupants[seat.historicalOccupantIndex];
      if (!occupant || occupant.departureYear == null) continue; // still serving to "present"

      const departureTurn = yearToTurn(occupant.departureYear, startingYear);
      if (calTurn < departureTurn) continue;

      // Every historical departure creates a playable vacancy. The remaining
      // authored chain is useful reference data, but it is not an appointment
      // queue. The Divergence Point remains the eventual live confirmation.
      if (await vacateSeatIfStillOccupied(database, seat, now)) {
        seatsVacatedByHistory++;
        await notifySeatVacated(database, seat, notifications, "history");
      }
      continue;
    }

    // Divergent seat: flat hazard clock while occupied by a player or NPP.
    if (!seat.justiceCharacterId && !seat.justiceNppId) continue;
    if (seat.divergentHazardStartsTurn == null || seat.seatedAtTurn == null) continue;

    const departs = rollDivergentDeparture(
      seat.seatedAtTurn,
      currentTurn,
      Math.random(),
      seat.divergentHazardStartsTurn
    );
    if (!departs) continue;

    if (await vacateSeatIfStillOccupied(database, seat, now)) {
      seatsVacatedByHazard++;
      await notifySeatVacated(database, seat, notifications, "death");
    }
  }

  await createNotifications(notifications);

  return { seatsAdvanced, seatsVacatedByHistory, seatsVacatedByHazard };
}
