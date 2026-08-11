import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type ProjectStatus = "construction" | "operational";
export type BuildFundingLevel = "slowed" | "standard" | "crashed";

/**
 * A transportation project. Builds over turns (construction), then flips to a
 * permanent operational asset emitting standing per-turn metric effects. The
 * construction lifecycle is the bespoke layer over the Estates/Energy roster.
 */
export interface InfraProject {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string; // resolved owning transportation seat
  archetypeId: string;
  name: string; // player-editable label
  icon: string; // infraUi icon key
  regionId: string; // states._id; set at Start, fixed
  status: ProjectStatus;
  progress: number; // accumulated build-progress units (turns at standard funding)
  buildDuration: number; // progress units to completion
  fundingLevel: BuildFundingLevel; // build-speed lever (construction only)
  outputBase: number; // display capacity
  upkeepBase: number; // M/turn operational upkeep
  constructionCostBase: number; // M/turn spend while building (× costMult)
  createdTurn: number;
  completedTurn?: number;
}
