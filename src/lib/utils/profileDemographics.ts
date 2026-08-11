import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type {
  CharacterDemographics,
  CharacterGender,
  CharacterRace,
  CharacterWealth,
  CharacterEducation,
} from "@/lib/db/types";

const GENDER_LABELS: Record<CharacterGender, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Non-binary",
};

const ETHNICITY_LABELS: Record<CharacterRace, string> = {
  white: "White",
  black: "Black",
  hispanic: "Hispanic",
  asian: "Asian",
  other: "Other",
};

const STARTING_CLASS_LABELS: Record<CharacterWealth, string> = {
  low: "Working Class",
  middle: "Middle Class",
  high: "Upper Class",
};

const EDUCATION_LABELS: Record<CharacterEducation, string> = {
  no_college: "No College",
  college: "College",
  graduate: "Graduate Degree",
};

function isCountryId(value: string): value is CountryId {
  return value in COUNTRY_CONFIGS;
}

export function getGenderLabel(gender?: CharacterGender | null): string | null {
  if (!gender) return null;
  return GENDER_LABELS[gender] ?? null;
}

export function getEthnicityLabel(race?: CharacterRace | null): string | null {
  if (!race) return null;
  return ETHNICITY_LABELS[race] ?? null;
}

export function getStartingClassLabel(wealth?: CharacterWealth | null): string | null {
  if (!wealth) return null;
  return STARTING_CLASS_LABELS[wealth] ?? null;
}

export function getEducationLabel(education?: CharacterEducation | null): string | null {
  if (!education) return null;
  return EDUCATION_LABELS[education] ?? null;
}

export function getNationalityLabel(countryId?: string | null): string | null {
  if (!countryId || !isCountryId(countryId)) return null;
  const config = COUNTRY_CONFIGS[countryId];
  return config.name;
}

export function buildDemographicsRows(
  demographics?: CharacterDemographics | null,
  startingCountryId?: string | null,
  currentCountryId?: string | null
) {
  return [
    { label: "Gender", value: getGenderLabel(demographics?.gender) },
    { label: "Starting Class", value: getStartingClassLabel(demographics?.wealth) },
    { label: "Ethnicity", value: getEthnicityLabel(demographics?.race) },
    { label: "Education", value: getEducationLabel(demographics?.education) },
    { label: "Starting Nationality", value: getNationalityLabel(startingCountryId) },
    { label: "Current Nationality", value: getNationalityLabel(currentCountryId) },
  ];
}
