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
}
