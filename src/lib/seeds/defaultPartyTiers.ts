import { US_ELECTIONS } from "@/lib/countries/us/elections";
import { UK_ELECTIONS } from "@/lib/countries/uk/elections";
import { DE_ELECTIONS } from "@/lib/countries/de/elections";
import { JP_ELECTIONS } from "@/lib/countries/jp/elections";
import { BR_ELECTIONS } from "@/lib/countries/br/elections";
import { IE_ELECTIONS } from "@/lib/countries/ie/elections";
import { CN_ELECTIONS } from "@/lib/countries/cn/elections";
import { NG_ELECTIONS } from "@/lib/countries/ng/elections";

export interface MajorDefaultParty {
  abbr: string;
  presets?: string[];
}

/**
 * Major default parties by country, for seed-time tier assignment (D5, the
 * 2026-06-18 tier proposal). Any default party NOT listed here seeds **Minor**;
 * custom parties always seed Minor.
 *
 * `presets` narrows a Major status to specific eras — needed only where a party
 * exists in BOTH presets but is Major in only one (DE Greens, BR PT). Era-
 * exclusive parties (e.g. JP JSP/CDP, IE SF, BR PMDB/PFL/PL) only seed in their
 * own preset anyway, so they need no `presets` filter.
 *
 * Seed tier is only the STARTING value — the `partyTierTurn` phase recomputes
 * tier from live Org every turn, so this just sets the badge/cap at game start.
 */
export const MAJOR_DEFAULT_PARTIES: Record<string, MajorDefaultParty[] | undefined> = {
  US: US_ELECTIONS.majorDefaultParties,
  UK: UK_ELECTIONS.majorDefaultParties,
  DE: DE_ELECTIONS.majorDefaultParties,
  JP: JP_ELECTIONS.majorDefaultParties,
  BR: BR_ELECTIONS.majorDefaultParties,
  IE: IE_ELECTIONS.majorDefaultParties,
  CN: CN_ELECTIONS.majorDefaultParties,
  NG: NG_ELECTIONS.majorDefaultParties,
};

/**
 * Resolve a party's seed tier for the given preset. Custom parties → `minor`;
 * default parties → `major` when listed in `MAJOR_DEFAULT_PARTIES` for the
 * preset, else `minor`.
 */
export function resolveSeedPartyTier(
  seed: { isDefault?: boolean; countryId: string; abbreviation: string },
  preset: string
): "major" | "minor" {
  if (!seed.isDefault) return "minor";
  const majors = MAJOR_DEFAULT_PARTIES[seed.countryId] ?? [];
  const isMajor = majors.some(
    (m) => m.abbr === seed.abbreviation && (!m.presets || m.presets.includes(preset))
  );
  return isMajor ? "major" : "minor";
}
