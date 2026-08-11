import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";

type CharacterExecutiveTermSnapshot = Pick<Character, "careerHistory" | "executiveTermsServed">;

function getHistoricalExecutiveTermsServed(
  character: CharacterExecutiveTermSnapshot,
  countryId: CountryId
): number {
  const officeKey = getCountryConfig(countryId).executiveTermLimit?.officeKey;
  if (!officeKey) return 0;
  return (
    character.careerHistory?.filter(
      (event) =>
        event.office?.type === officeKey &&
        (event.type === "appointed" || event.type === "elected") &&
        (event.partyCountryId === countryId || event.partyCountryId == null)
    ).length ?? 0
  );
}

export function getExecutiveTermsServed(
  character: CharacterExecutiveTermSnapshot,
  countryId: CountryId
): number {
  const storedTerms = character.executiveTermsServed?.[countryId] ?? 0;
  const historicalTerms = getHistoricalExecutiveTermsServed(character, countryId);
  return Math.max(storedTerms, historicalTerms);
}

export function getExecutiveTermLimit(countryId: CountryId): number | null {
  return getCountryConfig(countryId).executiveTermLimit?.maxTermsPerCharacter ?? null;
}

export function hasReachedExecutiveTermLimit(
  character: CharacterExecutiveTermSnapshot,
  countryId: CountryId
): boolean {
  const maxTerms = getExecutiveTermLimit(countryId);
  return maxTerms !== null && getExecutiveTermsServed(character, countryId) >= maxTerms;
}

export function incrementExecutiveTermsServedUpdate(
  character: CharacterExecutiveTermSnapshot,
  countryId: CountryId
): Record<string, number> {
  return {
    [`executiveTermsServed.${countryId}`]: getExecutiveTermsServed(character, countryId) + 1,
  };
}
