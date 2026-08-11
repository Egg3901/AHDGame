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
export const MAJOR_DEFAULT_PARTIES: Record<string, Array<{ abbr: string; presets?: string[] }>> = {
  US: [{ abbr: "DEM" }, { abbr: "REP" }],
  UK: [
    { abbr: "LAB" },
    { abbr: "CON" },
    // Lib Dems founded 1988; in 1953 the majors are Conservative + Labour and
    // the historic Liberal Party (LIB, 1953-only seed) is a Minor third party.
    {
      abbr: "LD",
      presets: [
        "1979-default",
        "1991-default",
        "1999-default",
        "2007-default",
        "2019-default",
        "2023-default",
      ],
    },
  ],
  DE: [{ abbr: "SPD" }, { abbr: "CDU" }, { abbr: "GRN", presets: ["2019-default"] }],
  JP: [
    // LDP formed Nov 1955; in 1953 the Liberal Party (RYO) was the major conservative force.
    // LDP is Major for all eras except 1953-default.
    {
      abbr: "LDP",
      presets: [
        "1979-default",
        "1991-default",
        "1999-default",
        "2007-default",
        "2019-default",
        "2023-default",
      ],
    },
    { abbr: "RYO", presets: ["1953-default"] },
    { abbr: "JSP" },
    { abbr: "CDP" },
  ],
  BR: [
    { abbr: "PMDB" },
    { abbr: "PFL" },
    { abbr: "PT", presets: ["2019-default"] },
    { abbr: "PL" },
  ],
  IE: [{ abbr: "FF" }, { abbr: "FG" }, { abbr: "SF" }],
  CN: [{ abbr: "CCP" }],
  NG: [
    // 2019 majors — era-exclusive so no presets filter needed.
    { abbr: "APC" },
    { abbr: "PDP" },
    // 1953 late-colonial triad (NCNC/AG/NPC) — all three were major regional
    // parties contesting under Macpherson/Lyttelton; NPC demographically largest.
    { abbr: "NCNC" },
    { abbr: "AG" },
    { abbr: "NPC" },
  ],
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
