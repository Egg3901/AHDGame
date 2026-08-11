import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Landesliste — Party list per state for German AMS (MMP) elections.
 *
 * Each party publishes an ordered list of candidates per Bundesland before
 * an election cycle. After Zweitstimmen are counted and list seats are
 * allocated, the top N candidates on each list receive seats (where N is
 * the party's list-seat quota for that Land).
 *
 * Party chairs can auto-generate lists from characters ranked by NPI, and
 * may reorder or swap candidates via dedicated chair actions.
 */
export interface Landesliste {
  _id: ObjectId;
  countryId: CountryId; // Always "DE" for now; keeps the door open for other MMP countries
  partyId: string;
  landId: string; // Bundesland ID (e.g. "BW", "BY", "NW")
  cycle: number; // Election cycle this list is valid for

  /** Ordered candidate IDs — position 0 gets the first list seat */
  candidates: ObjectId[];

  /** When the party chair finalized this list (lists locked once cycle starts) */
  lockedAt?: Date;

  /** Character ID of the party chair who authored or last edited the list */
  authoredBy?: ObjectId;

  createdAt: Date;
  updatedAt: Date;
}
