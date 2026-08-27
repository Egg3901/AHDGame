import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * A country's World Situation Board state: its war-footing cohesion and the
 * combat power committed to each theater. Per-country (keyed by `countryId`).
 * `available`/`reserve`/`total` are derived from the live-unit pool, not stored.
 */
export interface TheaterStateDoc {
  _id: ObjectId;
  countryId: CountryId;
  cohesion: number;
  committed: Record<string, number>;
  /**
   * Fronts where this nation joins an ally's offensive without declaring one itself,
   * keyed by theaterId. Absent or false is the old behaviour: you attack only when you
   * say so. A standing order of national policy, not a property of whoever currently
   * commands the theatre, so it survives a change of commander the way the deployment
   * and the posture do.
   */
  autoJoin?: Record<string, boolean>;
}
