import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ActingAppointmentCharge } from "../types/actingAppointmentCharge";

export function getActingChargesCollection(db: Db) {
  return db.collection<ActingAppointmentCharge>("actingAppointmentCharges");
}

/** Identifies one cabinet seat within one presidency. */
export interface ActingChargeKey {
  countryId: CountryId;
  positionId: string;
  presidentCharacterId: ObjectId;
  presidencyStartedAt: Date | null;
}

/** Has this President still got their acting appointment for this seat? */
export async function hasUnspentActingCharge(db: Db, key: ActingChargeKey): Promise<boolean> {
  const spent = await getActingChargesCollection(db).findOne({
    countryId: key.countryId,
    positionId: key.positionId,
    presidentCharacterId: key.presidentCharacterId,
    presidencyStartedAt: key.presidencyStartedAt,
  });
  return spent === null;
}

/**
 * Burn the seat's charge. Not refunded by any in-game event: not on expiry,
 * not on early dismissal, not when the Senate later confirms somebody. That
 * permanence is what turns the tenure cap into pressure to seek confirmation.
 *
 * The single exception is {@link refundActingCharge}, which exists only to
 * undo a charge whose appointment never happened.
 */
export async function spendActingCharge(
  db: Db,
  key: ActingChargeKey,
  appointeeCharacterId: ObjectId,
  turn: number
): Promise<void> {
  const now = new Date();
  await getActingChargesCollection(db).insertOne({
    countryId: key.countryId,
    positionId: key.positionId,
    presidentCharacterId: key.presidentCharacterId,
    presidencyStartedAt: key.presidencyStartedAt,
    appointeeCharacterId,
    spentOnTurn: turn,
    createdAt: now,
  } as ActingAppointmentCharge);
}

/**
 * Undo a charge whose appointment failed to seat.
 *
 * NOT a game mechanic: nothing a player does refunds a charge. This exists
 * purely so a write that failed halfway does not bill a President for an
 * appointment that never happened.
 */
export async function refundActingCharge(db: Db, key: ActingChargeKey): Promise<void> {
  await getActingChargesCollection(db).deleteOne({
    countryId: key.countryId,
    positionId: key.positionId,
    presidentCharacterId: key.presidentCharacterId,
    presidencyStartedAt: key.presidencyStartedAt,
  });
}
