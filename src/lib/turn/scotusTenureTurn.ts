/**
 * SCOTUS Tenure Turn (#3598).
 *
 * Two independent clocks, one per seat state:
 *
 *  - Original Roster seats (`isDivergent === false`): replay the authored
 *    `historicalOccupants` succession chain automatically — zero player
 *    action required — for as long as no divergence has occurred. When the
 *    current occupant's scripted departure turn is reached, the seat
 *    auto-advances to the next chain entry with no vacancy gap. Only once
 *    the chain is exhausted does the seat actually go vacant and become
 *    eligible for a live presidential nomination — which is, by
 *    construction, the Divergence Point (see `scotusNominationLifecycle.ts`
 *    `seatConfirmedJustice`).
 *
 *  - Divergent seats (`isDivergent === true`): flat per-turn hazard clock
 *    (`rollDivergentDeparture`), age-agnostic, uncapped on the high end.
 *    Player-held seats (`justiceCharacterId`) are exempt: the hazard is an
 *    NPP death/retirement stand-in, and the game has no player mortality
 *    (ticket #1135).
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { yearToTurn } from "@/lib/scotus/turnConversion";
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

async function notifySeatVacated(
  db: Db,
  seat: SupremeCourtSeat,
  notifications: NotificationInput[]
): Promise<void> {
  try {
    const notifiedUserIds = new Set<string>();

    if (seat.justiceCharacterId) {
      const occupant = await db
        .collection<Character>("characters")
        .findOne({ _id: seat.justiceCharacterId }, { projection: { userId: 1 } });
      if (occupant?.userId) {
        notifiedUserIds.add(occupant.userId.toString());
        notifications.push({
          userId: occupant.userId,
          type: "system",
          title: "Left the Supreme Court",
          message: `Your tenure on Supreme Court seat #${seat.seatNumber} has ended. The seat is now vacant.`,
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
        const justiceLabel = seat.justiceName?.trim() || "A justice";
        notifications.push({
          userId: presidentChar.userId,
          type: "system",
          title: "Supreme Court vacancy",
          message: `${justiceLabel} has left the Court. Seat #${seat.seatNumber} is vacant. You may nominate a replacement.`,
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

  const seats = await database
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ countryId: "US" })
    .toArray();

  let seatsAdvanced = 0;
  let seatsVacatedByHistory = 0;
  let seatsVacatedByHazard = 0;
  const now = new Date();
  const notifications: NotificationInput[] = [];

  for (const seat of seats) {
    // A living player on the bench is never overwritten by Original Roster
    // replay and never rolled on the NPP mortality stand-in.
    if (playerHoldsSeat(seat)) continue;

    if (!seat.isDivergent) {
      const occupant = seat.historicalOccupants[seat.historicalOccupantIndex];
      if (!occupant || occupant.departureYear == null) continue; // still serving to "present"

      const departureTurn = yearToTurn(occupant.departureYear, startingYear);
      if (currentTurn < departureTurn) continue;

      const nextOccupant = seat.historicalOccupants[seat.historicalOccupantIndex + 1];
      if (nextOccupant) {
        await database.collection<SupremeCourtSeat>("supremeCourtSeats").updateOne(
          { _id: seat._id },
          {
            $set: {
              historicalOccupantIndex: seat.historicalOccupantIndex + 1,
              justiceName: nextOccupant.name,
              justiceParty: nextOccupant.party ?? null,
              economicLean: nextOccupant.economicLean,
              socialLean: nextOccupant.socialLean,
              seatedAt: now,
              seatedAtTurn: currentTurn,
              updatedAt: now,
            },
          }
        );
        seatsAdvanced++;
      } else {
        // Original Roster chain exhausted — seat goes vacant, awaiting a
        // live presidential nomination. NOT a divergence by itself; the
        // Divergence Point is the confirmation, not the vacancy.
        await database
          .collection<SupremeCourtSeat>("supremeCourtSeats")
          .updateOne({ _id: seat._id }, { $set: vacatedOccupantFields(now) });
        seatsVacatedByHistory++;
        await notifySeatVacated(database, seat, notifications);
      }
      continue;
    }

    // Divergent NPP seat: flat hazard clock, only while actually occupied.
    if (!seat.justiceNppId) continue;
    if (seat.divergentHazardStartsTurn == null || seat.seatedAtTurn == null) continue;

    const departs = rollDivergentDeparture(
      seat.seatedAtTurn,
      currentTurn,
      Math.random(),
      seat.divergentHazardStartsTurn
    );
    if (!departs) continue;

    await database
      .collection<SupremeCourtSeat>("supremeCourtSeats")
      .updateOne({ _id: seat._id }, { $set: vacatedOccupantFields(now) });
    seatsVacatedByHazard++;
    await notifySeatVacated(database, seat, notifications);
  }

  await createNotifications(notifications);

  return { seatsAdvanced, seatsVacatedByHistory, seatsVacatedByHazard };
}
