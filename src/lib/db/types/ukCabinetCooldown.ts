import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Per-seat appointment cooldown. A cabinet position can only be (re)appointed
 * once every N turns; the lock is keyed to the APPOINTMENT (not firing) and
 * persists even if the holder is fired before it elapses. Firing a minister is
 * unrestricted and never writes one of these.
 */
export interface UKCabinetCooldown {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  /** Holder whose appointment started this lock. */
  appointedCharacterId: ObjectId;
  /** PM who made the appointment. */
  appointedByPmCharacterId: ObjectId;
  appointedAt: Date;
  cooldownUntil: Date;
  /**
   * Turn-based mirror of `cooldownUntil`. The appointment guard resolves against
   * this so the cooldown freezes on pause (no drift vs the wall clock). Optional
   * for legacy (pre-appointment-cooldown) docs; new cooldowns set both. See
   * [[project-turn-based-deadline-migration]].
   */
  cooldownUntilTurn?: number;
}
