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
 * Burn the seat's charge. Never refunded: not on expiry, not on early
 * dismissal, not when the Senate later confirms somebody. That permanence is
 * what turns the tenure cap into pressure to seek confirmation.
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
