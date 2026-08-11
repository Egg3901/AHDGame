import { badRequest } from "@/lib/api/errors";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  hasConfidenceVoteMechanism,
  isParliamentarySystem,
  supportsSnapElections,
  type CountryConfig,
  type CountryId,
} from "@/lib/constants/countries";

export function getParliamentaryCountryId(code: string): CountryId {
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) {
    throw badRequest("Invalid country code");
  }
  if (!isParliamentarySystem(config)) {
    throw badRequest("This country does not use parliamentary PM appointment");
  }
  return countryId;
}

export function getParliamentaryCountryConfig(countryId: CountryId): CountryConfig {
  return getCountryConfig(countryId);
}

export function assertSnapElectionsAllowed(countryId: CountryId): CountryConfig {
  const config = getCountryConfig(countryId);
  if (!supportsSnapElections(config)) {
    throw badRequest("Snap elections are not available in this country");
  }
  return config;
}

export function assertConfidenceVoteMechanism(countryId: CountryId): CountryConfig {
  const config = getCountryConfig(countryId);
  if (!hasConfidenceVoteMechanism(config)) {
    throw badRequest("No-confidence votes are not available in this country");
  }
  return config;
}
