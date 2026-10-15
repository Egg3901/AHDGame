/**
 * Corporation CEO residency. Human CEOs must live at a private corporation's
 * headquarters, while national corporations allow any resident of their country.
 */

export type CharacterCeoResidencyFailure = "headquarters-state" | "country";

export interface CharacterCeoResidencyCandidate {
  homeState?: string | null;
  countryId?: string | null;
}

export interface CharacterCeoResidencyCorporation {
  headquartersState?: string | null;
  countryId?: string | null;
}

/** Return why a character fails a corporation's human-CEO residency rule. */
export function characterCeoResidencyFailure(
  candidate: CharacterCeoResidencyCandidate,
  corporation: CharacterCeoResidencyCorporation,
  options: { countryWide?: boolean } = {}
): CharacterCeoResidencyFailure | null {
  if (
    !options.countryWide &&
    (!candidate.homeState ||
      !corporation.headquartersState ||
      candidate.homeState !== corporation.headquartersState)
  ) {
    return "headquarters-state";
  }
  if (corporation.countryId && candidate.countryId !== corporation.countryId) {
    return "country";
  }
  return null;
}
