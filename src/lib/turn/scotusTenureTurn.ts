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
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { yearToTurn } from "@/lib/scotus/turnConversion";
import { rollDivergentDeparture } from "@/lib/scotus/tenure";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export interface ScotusTenureTurnResult {
  seatsAdvanced: number;
  seatsVacatedByHistory: number;
  seatsVacatedByHazard: number;
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

  for (const seat of seats) {
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
        await database.collection<SupremeCourtSeat>("supremeCourtSeats").updateOne(
          { _id: seat._id },
          {
            $set: {
              justiceMode: null,
              justiceCharacterId: null,
              justiceNppId: null,
              justiceName: null,
              justiceParty: null,
              economicLean: null,
              socialLean: null,
              seatedAt: null,
              seatedAtTurn: null,
              updatedAt: now,
            },
          }
        );
        seatsVacatedByHistory++;
      }
      continue;
    }

    // Divergent seat: flat hazard clock, only while actually occupied.
    if (!seat.justiceCharacterId && !seat.justiceNppId) continue;
    if (seat.divergentHazardStartsTurn == null || seat.seatedAtTurn == null) continue;

    const departs = rollDivergentDeparture(
      seat.seatedAtTurn,
      currentTurn,
      Math.random(),
      seat.divergentHazardStartsTurn
    );
    if (!departs) continue;

    await database.collection<SupremeCourtSeat>("supremeCourtSeats").updateOne(
      { _id: seat._id },
      {
        $set: {
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
        },
      }
    );
    seatsVacatedByHazard++;
  }

  return { seatsAdvanced, seatsVacatedByHistory, seatsVacatedByHazard };
}
