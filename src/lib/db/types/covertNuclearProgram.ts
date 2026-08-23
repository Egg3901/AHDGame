import type { CountryId } from "@/lib/constants/countries";
import type { CovertProgramState } from "@/lib/military/covertNuclear";

/**
 * Per-country covert nuclear programme: the DDR's hidden grind toward a bomb.
 * One doc per country, keyed by countryId (nuclearPrograms pattern). Nothing
 * in this document ever renders outside the defence seat's own panel.
 */
export interface CovertNuclearProgram extends CovertProgramState {
  _id: CountryId;
  /** Turn the breakout test went public, if it ever did. Breakout is once. */
  brokenOutTurn?: number;
  updatedAt: Date;
}
