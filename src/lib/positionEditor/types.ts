import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { DemographicPosition } from "@/lib/seeds/demographicCategories";
import type { EraId } from "@/lib/seeds/presetSelector";

/** Per Layer-1 key: share %, baseline turnout %, and econ/social position. */
export interface EditorLayer1Entry extends DemographicPosition {
  share: number; // 0-100, sums to 100 within a dimension
  turnout: number; // 0-100
}
export type EditorDimension = Record<string, EditorLayer1Entry>;
export type EditorLayer1Config = Record<string, EditorDimension>;

export interface EditorCompositionWeight {
  dim: string;
  key: string;
  w: number;
}
export interface EditorArchetype {
  id: string;
  name: string;
  weights: EditorCompositionWeight[];
  civicMultiplier: number;
}

export interface EditorStateConfig {
  era: EraId;
  countryId: string;
  stateId: string;
  dims: string[];
  categoryId: string;
  layer1: EditorLayer1Config;
  archetypes: EditorArchetype[];
}

export interface DerivedArchetype {
  id: string;
  name: string;
  populationShare: number; // %
  votingPoolShare: number; // % of turnout-weighted pool
  economicLean: number;
  socialLean: number;
  turnout: number;
}
export interface DerivedComposition {
  archetypes: DerivedArchetype[];
  stateEconomicLean: number;
  stateSocialLean: number;
  stateDisplayLean: number;
}

export type { Layer1Config, EraId };
