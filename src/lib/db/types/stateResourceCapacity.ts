import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ExtractableResource } from "@/lib/constants/commodities";

export interface StateResourceCapacity {
  _id: ObjectId;
  stateId: string;
  countryId: CountryId;
  /**
   * Maximum extractable output ceiling for each resource, in commodity units on
   * the DAILY basis — the same basis as `sector.revenue` and `capitalStock`, which
   * are what this ceiling is compared against. It is NOT per game turn: a turn is
   * a fraction of a day on the money timescale, so reading this as units/turn
   * overstates the ration. Everything downstream is already daily, so the numbers
   * are self-consistent; only the label was wrong.
   */
  resources: Partial<Record<ExtractableResource, number>>;
  /**
   * P3b (plants tier): cumulative units of each resource extracted from this
   * state since the world began. Deposits are finite —
   * `resources[r] × DEPOSIT_RESERVE_TURNS` is the derived reserve and this
   * counter is what has been taken out of it. See `@/lib/extraction/depletion`.
   * Absent ⇒ untouched deposit (the pre-P3b world, and the non-plants world,
   * where nothing writes it).
   */
  extractedUnits?: Partial<Record<ExtractableResource, number>>;
  updatedAt: Date;
}
