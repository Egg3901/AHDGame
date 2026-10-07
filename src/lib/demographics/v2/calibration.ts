/**
 * Versioned country calibration for the portable Demographics v2 rules.
 *
 * These packs change only bounded response strengths. Population composition,
 * voting age, registration, and campaign activity still come from live world
 * data. Keeping the numbers here makes balance changes reviewable and lets the
 * headless simulation run the exact same rules as the turn processor.
 */
export interface DemographicsV2Calibration {
  id: string;
  rulesVersion: 1;
  turnoutFloor: number;
  turnoutCeiling: number;
  salienceRangePoints: number;
  competitivenessMaxPoints: number;
  accessMaxPoints: number;
  contactCapPoints: number;
  saturationPenaltyFraction: number;
  issueAxisMin: number;
  issueAxisMax: number;
  issueContrastSpan: number;
  competitiveGapSpan: number;
}

export const DEFAULT_DEMOGRAPHICS_V2_CALIBRATION: DemographicsV2Calibration = {
  id: "global-v1",
  rulesVersion: 1,
  turnoutFloor: 15,
  turnoutCeiling: 95,
  salienceRangePoints: 6,
  competitivenessMaxPoints: 3,
  accessMaxPoints: 4,
  contactCapPoints: 8,
  saturationPenaltyFraction: 0.5,
  issueAxisMin: 0.85,
  issueAxisMax: 1.15,
  issueContrastSpan: 8,
  competitiveGapSpan: 30,
};

const STANDARD_COUNTRY_IDS = [
  "US",
  "UK",
  "DE",
  "JP",
  "IE",
  "BR",
  "CN",
  "NG",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BLR",
  "UKR",
  "CS",
  "BAL",
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "DD",
  "SCO",
  "WAL",
] as const;

const STANDARD_COUNTRY_PACKS = Object.fromEntries(
  STANDARD_COUNTRY_IDS.map((countryId) => [
    countryId,
    { ...DEFAULT_DEMOGRAPHICS_V2_CALIBRATION, id: `${countryId}-v1` },
  ])
);

const COUNTRY_PACKS: Readonly<Record<string, DemographicsV2Calibration>> = {
  ...STANDARD_COUNTRY_PACKS,
  US: {
    ...DEFAULT_DEMOGRAPHICS_V2_CALIBRATION,
    id: "US-v1",
    accessMaxPoints: 4,
    contactCapPoints: 8,
  },
  UK: {
    ...DEFAULT_DEMOGRAPHICS_V2_CALIBRATION,
    id: "UK-v1",
    accessMaxPoints: 2.5,
    contactCapPoints: 7,
  },
  JP: {
    ...DEFAULT_DEMOGRAPHICS_V2_CALIBRATION,
    id: "JP-v1",
    accessMaxPoints: 3,
    contactCapPoints: 6,
  },
};

export function demographicsV2CalibrationForCountry(countryId: string): DemographicsV2Calibration {
  return COUNTRY_PACKS[countryId] ?? DEFAULT_DEMOGRAPHICS_V2_CALIBRATION;
}
