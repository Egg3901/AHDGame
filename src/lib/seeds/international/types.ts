export interface DemographicPosition {
  economicLean: number;
  socialLean: number;
}
export interface CompositionEntry {
  weights: Array<{ dim: string; key: string; w: number }>;
  civicMultiplier?: number;
}
export interface CountryLayer1Model {
  countryId: string;
  categoryId: string;
  groupIds: string[];
  dims: string[];
  turnoutRates: Record<string, Record<string, number>>;
  positions: Record<string, Record<string, DemographicPosition>>;
  composition: Record<string, CompositionEntry>;
  defaultLeans: Record<string, { economicLean: number; socialLean: number }>;
  census: Record<string, Record<string, Record<string, number>>>;
}
