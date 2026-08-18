import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SupremeCourtSeat, DocketCase } from "@/lib/db/types/scotus";
import { getGameState } from "@/lib/gameState";
import { divergentDeathChance, type DivergentDeathChance } from "@/lib/scotus/tenure";

/**
 * Read layer for #3598 scope item 9 (visibility). Exact UI is out of scope
 * (#3581) — these are the data functions a future page/route would call for:
 *  - current Court composition (per-justice ideology, vacant seats)
 *  - full justice roster + ideology leans
 *  - history of past Docket cases and outcomes
 */

export interface ScotusSeatSummary {
  seatNumber: number;
  vacant: boolean;
  justiceName: string | null;
  justiceParty: string | null;
  justiceMode: SupremeCourtSeat["justiceMode"];
  economicLean: number | null;
  socialLean: number | null;
  isDivergent: boolean;
  deathChance: DivergentDeathChance | null;
}

/** Current Court composition — one row per seat, vacant seats included so callers can see what's open before nominating. */
export async function getScotusComposition(
  db: Db,
  countryId: CountryId
): Promise<ScotusSeatSummary[]> {
  const [seats, gameState] = await Promise.all([
    db
      .collection<SupremeCourtSeat>("supremeCourtSeats")
      .find({ countryId })
      .sort({ seatNumber: 1 })
      .toArray(),
    getGameState(db),
  ]);
  const currentTurn = gameState?.currentTurn;

  return seats.map((seat) => {
    const vacant =
      !seat.justiceCharacterId && !seat.justiceNppId && seat.justiceMode !== "historical";
    return {
      seatNumber: seat.seatNumber,
      vacant,
      justiceName: seat.justiceName,
      justiceParty: seat.justiceParty,
      justiceMode: seat.justiceMode,
      economicLean: seat.economicLean,
      socialLean: seat.socialLean,
      isDivergent: seat.isDivergent,
      deathChance:
        !vacant && seat.isDivergent && currentTurn != null
          ? divergentDeathChance(currentTurn, seat.divergentHazardStartsTurn)
          : null,
    };
  });
}

/** History of past Docket cases and their outcomes (affirmed/diverged), most recent first. */
export async function getScotusCaseHistory(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<DocketCase[]> {
  return db
    .collection<DocketCase>("docketCases")
    .find({
      countryId,
      status: "decided",
      ...(preset && { preset }),
    })
    .sort({ decidedAtTurn: -1 })
    .toArray();
}

/** Full Docket (pending + decided) for a preset — used alongside case history for a complete timeline view. */
export async function getScotusDocket(
  db: Db,
  countryId: CountryId,
  preset: string
): Promise<DocketCase[]> {
  return db
    .collection<DocketCase>("docketCases")
    .find({ countryId, preset })
    .sort({ decisionYear: 1 })
    .toArray();
}
