import type { CountryId } from "@/lib/constants/countries";

/**
 * Per-country nuclear weapons program: adopted tree nodes, the stockpile the
 * programme has built, and the production rate the defence seat has ordered.
 * One doc per country, keyed by countryId (nationalDoctrine pattern).
 */
export interface NuclearProgram {
  _id: CountryId;
  /** node key → game turn it was adopted (device nodes adopt via a test). */
  adopted: Record<string, number>;
  /** Warheads in the stockpile. */
  warheads: number;
  /** Ordered warheads per turn, clamped to the adopted device tier's cap. */
  productionRate: number;
  /** Turn of the most recent nuclear test, if any. */
  lastTestTurn?: number;
  updatedAt: Date;
}
