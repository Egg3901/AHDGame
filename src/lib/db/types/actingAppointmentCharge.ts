import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * One spent acting-appointment charge.
 *
 * A President gets `ACTING_CHARGES_PER_SEAT` acting appointments per cabinet
 * seat per presidency. The charge is spent on appointment and never refunded,
 * so a seat whose charge is gone can only be filled by confirmation for the
 * rest of that presidency.
 *
 * This is a collection rather than a field on the cabinet member because the
 * charge has to OUTLIVE the member row, which is deleted when the appointment
 * lapses. Collection: "actingAppointmentCharges".
 */
export interface ActingAppointmentCharge {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  /** The President who spent it. */
  presidentCharacterId: ObjectId;
  /**
   * The President's `electedOfficials.electedAt`, discriminating a second term
   * from a first so re-election restores a fresh set of charges. `null` on
   * legacy rows with no `electedAt`, which degrades to per-president identity.
   */
  presidencyStartedAt: Date | null;
  appointeeCharacterId: ObjectId;
  spentOnTurn: number;
  createdAt: Date;
}
