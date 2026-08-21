/**
 * Which way a delegation pushes.
 *
 * NEVER stored on the seat. A seat's side is its country's LIVE treaty
 * membership, read through `loadBlocMembership`, which derives the answer from
 * the era's accession-governing organisations rather than from any hardcoded
 * pairing. A Britain that has somehow joined the Warsaw Pact plays East, and
 * nothing here needs changing for that to work.
 *
 * A country in NEITHER bloc has no direction and therefore no official plays.
 * That is the honest reading of "direction follows bloc": a non-aligned Britain
 * is not a four-power principal any more. Its officeholders keep their personal
 * plays, which choose their own direction.
 */
import type { Db } from "mongodb";
import { loadBlocMembership } from "@/lib/world/blocMembership";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { SETTLEMENT_SEATS, type SettlementSeatKey } from "@/lib/constants/settlementCrisis";

export type SettlementDirection = 1 | -1;

function directionFromBloc(bloc: string | undefined): SettlementDirection | null {
  if (bloc === "east") return 1;
  if (bloc === "west") return -1;
  return null;
}

export async function resolveSeatDirection(
  db: Db,
  seatId: SettlementSeatKey
): Promise<SettlementDirection | null> {
  const preset = await getGameStatePresetOrDefault(db);
  const membership = await loadBlocMembership(db, preset);
  return directionFromBloc(membership[seatId]);
}

/** Every seat's direction from ONE membership read, for the read model. */
export async function resolveAllSeatDirections(
  db: Db
): Promise<Record<SettlementSeatKey, SettlementDirection | null>> {
  const preset = await getGameStatePresetOrDefault(db);
  const membership = await loadBlocMembership(db, preset);
  const out = {} as Record<SettlementSeatKey, SettlementDirection | null>;
  for (const seat of SETTLEMENT_SEATS) {
    out[seat.id] = directionFromBloc(membership[seat.id]);
  }
  return out;
}
