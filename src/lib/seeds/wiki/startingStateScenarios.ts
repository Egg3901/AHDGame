/**
 * Derived starting-state data for the Game Starting State wiki page.
 *
 * Provides per-country seat composition for the "1991" scenario, computed
 * once from the existing _1990/_1992 historical seat arrays in
 * `src/lib/constants/historicalSeats.ts`. The dashboard widget consumes
 * this so it doesn't recompute totals on every render.
 */

import {
  BR_CHAMBER_1991,
  BR_SENATE_1991,
  CN_GOVERNORS_1991,
  CN_NPC_1991,
  DE_BUNDESTAG_1990,
  DE_MINISTERPRAESIDENTEN_1992,
  IE_DAIL_1991,
  JP_GOVERNORS_1991,
  JP_SANGIIN_1989,
  JP_SHUGIIN_1990,
  UK_COMMONS_1992,
  US_GOVERNORS_1992,
  US_HOUSE_1992,
  US_SENATE_1992,
  type HistoricalSeat,
} from "@/lib/constants/historicalSeats";
import type { CountryId } from "@/lib/constants/countries";

export type ScenarioCountryId = Extract<
  CountryId,
  "US" | "UK" | "JP" | "DE" | "CN" | "BR" | "IE" | "NG"
>;

export interface ScenarioPartyTotal {
  partySlug: string;
  partyName: string;
  color: string;
  seats: number;
}

export interface ScenarioChamber {
  /** Display label, e.g. "House of Representatives". */
  label: string;
  /** Short label for tight UI, e.g. "House". */
  shortLabel: string;
  totalSeats: number;
  parties: ScenarioPartyTotal[];
}

export interface ScenarioCountry {
  countryId: ScenarioCountryId;
  /** Historical event label that frames the seat snapshot. */
  contextLabel: string;
  /** Quick narrative for the scenario. */
  posture: string;
  chambers: ScenarioChamber[];
}

const PARTY_DISPLAY: Record<string, { name: string; color: string }> = {
  // US
  democrat: { name: "Democratic Party", color: "#3B82F6" },
  republican: { name: "Republican Party", color: "#EF4444" },
  independent: { name: "Independent", color: "#94A3B8" },
  // UK
  uk_labour: { name: "Labour Party", color: "#DC241F" },
  uk_conservative: { name: "Conservative Party", color: "#0087DC" },
  uk_libdem: { name: "Liberal Democrats", color: "#FAA61A" },
  uk_snp: { name: "Scottish National Party", color: "#FDF38E" },
  uk_plaid: { name: "Plaid Cymru", color: "#3F8428" },
  uk_dup: { name: "Democratic Unionist Party", color: "#D46A4C" },
  uk_sf: { name: "Sinn Féin", color: "#326760" },
  uk_sdlp: { name: "SDLP", color: "#2AA82C" },
  uk_alliance: { name: "Alliance Party", color: "#F6CB2F" },
  uk_uup: { name: "Ulster Unionist Party", color: "#9999FF" },
  uk_speaker: { name: "Speaker", color: "#94A3B8" },
  uk_independent: { name: "Independent", color: "#94A3B8" },
  // JP: 2019-era
  jp_ldp: { name: "Liberal Democratic Party", color: "#3CA324" },
  jp_cdp: { name: "Constitutional Democratic Party", color: "#1E4D8C" },
  jp_komeito: { name: "Komeito", color: "#F55881" },
  jp_jcp: { name: "Japanese Communist Party", color: "#DB001C" },
  jp_ishin: { name: "Nippon Ishin no Kai", color: "#39B54A" },
  jp_dpfp: { name: "Democratic Party for the People", color: "#FBB917" },
  // JP minor 2019-era (resolve to "independent" if not seeded: labels for
  // scenario display so tallies don't render the raw slug)
  jp_sdp: { name: "Social Democratic Party", color: "#88BBFF" },
  jp_reiwa: { name: "Reiwa Shinsengumi", color: "#E50012" },
  jp_nhk: { name: "NHK Party", color: "#FFA500" },
  // JP: 1991-era
  jp_jsp: { name: "Japan Socialist Party", color: "#C8102E" },
  jp_dsp: { name: "Democratic Socialist Party", color: "#0E5FAA" },
  jp_independent: { name: "Independent / Other", color: "#94A3B8" },
  // DE: 2019-era
  de_spd: { name: "SPD", color: "#E3000F" },
  de_cdu: { name: "CDU", color: "#000000" },
  de_csu: { name: "CSU", color: "#0080C8" },
  de_greens: { name: "Bündnis 90/Die Grünen", color: "#1AA037" },
  de_fdp: { name: "FDP", color: "#FFED00" },
  de_linke: { name: "Die Linke", color: "#BE3075" },
  de_afd: { name: "Alternative für Deutschland", color: "#009EE0" },
  // DE: 1991-era
  de_pds: { name: "Partei des Demokratischen Sozialismus", color: "#8E44AD" },
  de_independent: { name: "Independent", color: "#94A3B8" },
  // CN
  cn_ccp: { name: "Chinese Communist Party", color: "#DE2910" },
  cn_cdl: { name: "China Democratic League", color: "#F4A460" },
  cn_cndca: { name: "China Nat. Democratic Construction Assoc.", color: "#DAA520" },
  // BR
  br_pmdb: { name: "PMDB", color: "#228B22" },
  br_pfl: { name: "PFL", color: "#4169E1" },
  br_pdt: { name: "PDT", color: "#DC241F" },
  br_pds: { name: "PDS", color: "#8B4513" },
  br_ptb: { name: "PTB", color: "#006400" },
  br_prn: { name: "PRN", color: "#FF8C00" },
  br_pt: { name: "PT (Workers' Party)", color: "#CC0000" },
  br_pl: { name: "PL", color: "#483D8B" },
  br_psb: { name: "PSB", color: "#FF6347" },
  br_pcdob: { name: "PCdoB", color: "#8B0000" },
  br_psd: { name: "PSD", color: "#708090" },
  br_other: { name: "Other / Minor Parties", color: "#94A3B8" },
  // IE
  ie_ff: { name: "Fianna Fáil", color: "#4DA918" },
  ie_fg: { name: "Fine Gael", color: "#004D91" },
  ie_labour: { name: "Labour Party", color: "#CC0000" },
  ie_wp: { name: "Workers' Party", color: "#8B0000" },
  ie_pd: { name: "Progressive Democrats", color: "#003F87" },
  ie_ind: { name: "Independent / Other", color: "#94A3B8" },
};

function lookupParty(slug: string): { name: string; color: string } {
  return PARTY_DISPLAY[slug] ?? { name: slug, color: "#94A3B8" };
}

function tally(seats: readonly HistoricalSeat[]): ScenarioPartyTotal[] {
  const totals = new Map<string, number>();
  for (const seat of seats) {
    const count = seat.seatsHeld ?? 1;
    totals.set(seat.party, (totals.get(seat.party) ?? 0) + count);
  }
  return [...totals.entries()]
    .map(([partySlug, count]) => {
      const display = lookupParty(partySlug);
      return {
        partySlug,
        partyName: display.name,
        color: display.color,
        seats: count,
      };
    })
    .sort((a, b) => b.seats - a.seats);
}

function chamberTotal(parties: readonly ScenarioPartyTotal[]): number {
  return parties.reduce((sum, party) => sum + party.seats, 0);
}

function buildChamber(
  label: string,
  shortLabel: string,
  seats: readonly HistoricalSeat[]
): ScenarioChamber {
  const parties = tally(seats);
  return {
    label,
    shortLabel,
    totalSeats: chamberTotal(parties),
    parties,
  };
}

export const STARTING_STATE_1991_COUNTRIES: readonly ScenarioCountry[] = [
  {
    countryId: "US",
    contextLabel: "102nd Congress (1991-1993)",
    posture:
      "Democrats held a strong House majority and the Senate, with Bush in the White House. One Independent (Bernie Sanders, VT) joined the House.",
    chambers: [
      buildChamber("House of Representatives", "House", US_HOUSE_1992),
      buildChamber("Senate", "Senate", US_SENATE_1992),
      buildChamber("Governors", "Governors", US_GOVERNORS_1992),
    ],
  },
  {
    countryId: "UK",
    contextLabel: "Post-April 1992 General Election",
    posture:
      "John Major's Conservatives held on with a slim majority. Devolved legislatures did not yet exist.",
    chambers: [buildChamber("House of Commons", "Commons", UK_COMMONS_1992)],
  },
  {
    countryId: "JP",
    contextLabel: "Post-1990 Shugiin / Post-1989 Sangiin",
    posture:
      "LDP held the Shugiin with the JSP as principal opposition. The Sangiin was hung after the 1989 election upset.",
    chambers: [
      buildChamber("House of Representatives (Shugiin)", "Shugiin", JP_SHUGIIN_1990),
      buildChamber("House of Councillors (Sangiin)", "Sangiin", JP_SANGIIN_1989),
      buildChamber("Regional Governors", "Governors", JP_GOVERNORS_1991),
    ],
  },
  {
    countryId: "DE",
    contextLabel: "12th Bundestag (1990-1994)",
    posture:
      "First all-German Bundestag after reunification. Kohl's CDU/CSU-FDP coalition held the chamber.",
    chambers: [
      buildChamber("Bundestag", "Bundestag", DE_BUNDESTAG_1990),
      buildChamber("Ministerpräsidenten", "Länder", DE_MINISTERPRAESIDENTEN_1992),
    ],
  },
  {
    countryId: "CN",
    contextLabel: "7th National People's Congress (1988-1993)",
    posture:
      "CPC held ~97% of NPC seats. China Democratic League and CNDCA held token positions. All regional governors were CPC-affiliated.",
    chambers: [
      buildChamber("National People's Congress", "NPC", CN_NPC_1991),
      buildChamber("Regional Governors", "Governors", CN_GOVERNORS_1991),
    ],
  },
  {
    countryId: "BR",
    contextLabel: "49th Congress (post-October 1990 elections)",
    posture:
      "Collor de Mello's PRN was a minor force; PMDB and PFL dominated. No single party held a majority in a highly fragmented chamber.",
    chambers: [
      buildChamber("Chamber of Deputies", "Chamber", BR_CHAMBER_1991),
      buildChamber("Federal Senate", "Senate", BR_SENATE_1991),
    ],
  },
  {
    countryId: "IE",
    contextLabel: "27th Dáil (post-June 1989 General Election)",
    posture:
      "Fianna Fáil formed government in coalition with the Progressive Democrats: FF's first-ever coalition. Fine Gael led the opposition.",
    chambers: [buildChamber("Dáil Éireann", "Dáil", IE_DAIL_1991)],
  },
  {
    countryId: "NG",
    contextLabel: "3rd Republic (post-1991 census)",
    posture:
      "Ibrahim Babangida's military transition program. The National Assembly existed but real power lay with the Armed Forces Ruling Council. June 1993 presidential election was annulled.",
    chambers: [
      buildChamber("House of Representatives", "House", []),
      buildChamber("Senate", "Senate", []),
    ],
  },
];

export const STARTING_STATE_1991_COUNTRY_IDS: readonly ScenarioCountryId[] =
  STARTING_STATE_1991_COUNTRIES.map((country) => country.countryId);

export function getScenarioCountry(countryId: ScenarioCountryId): ScenarioCountry | undefined {
  return STARTING_STATE_1991_COUNTRIES.find((country) => country.countryId === countryId);
}

/** Countries that have no 1991 seed data: the dashboard shows a placeholder for these. */
export const STARTING_STATE_1991_UNSEEDED_COUNTRIES: readonly CountryId[] = [];

// ── Cold-War player start scenarios (RU / DD) ────────────────────────────────
//
// Narrative openings for the one-party bloc countries, keyed to office types
// that actually run elections in the 1953/1979 presets (see COUNTRY_CONFIGS.RU
// and .DD officeTypes, and the ddVolkskammer / ruSupremeSoviet cycle anchors).
// Rendered into the ru-overview / dd-overview wiki pages, which import this
// module so the scenario copy and the office keys stay in one place.

/** Office-type keys a bloc scenario may target. Every key exists in the
 * country's `officeTypes` and holds a real election in the Cold-War presets. */
export type BlocScenarioOfficeKey =
  "supremeSovietDeputy" | "nationalitiesDeputy" | "volkskammerDeputy" | "governor";

export interface PlayerStartScenario {
  countryId: Extract<CountryId, "RU" | "DD">;
  title: string;
  /** The first office the scenario aims at. */
  officeType: BlocScenarioOfficeKey;
  /** Player-facing label of that office in this country. */
  officeLabel: string;
  /** One-line framing. */
  hook: string;
  /** How the opening turns play out. */
  path: string;
}

export const PLAYER_START_SCENARIOS: readonly PlayerStartScenario[] = [
  {
    countryId: "RU",
    title: "The rising cadre",
    officeType: "nationalitiesDeputy",
    officeLabel: "Nationalities Deputy",
    hook: "A young CPSU cadre from one of the union republics, sent to Moscow on the republic's delegation.",
    path: "Stand in your republic's multi-seat race for the Soviet of Nationalities: 640 seats weighted by republic, elected the same day as the Union chamber on a four-year cycle. The seat carries +1 action per turn. From there work the apparat: ministers are appointed straight from Supreme Soviet deputies, Republic First Secretary adds +2 actions, and the Premier's chair at the top turns on internal party confidence, not a public vote.",
  },
  {
    countryId: "RU",
    title: "The Gosplan track",
    officeType: "supremeSovietDeputy",
    officeLabel: "Supreme Soviet Deputy",
    hook: "An economic manager out of heavy industry. The plan is your politics.",
    path: "Win a Soviet of the Union seat in an industrial region, then lobby the Premier for Chairman of the State Planning Committee. The Gosplan seat sets the Plan Emphasis tier (producer goods against consumer goods), carries the Mid-Plan Revision and Shock Work Campaign orders, and in a command-economy world it operates the national plan panel: output quotas and the investment split across every sector. Chronic under-fulfilment feeds shortage and pushes the marketization dial toward reform, so hit the targets.",
  },
  {
    countryId: "DD",
    title: "The SED functionary",
    officeType: "volkskammerDeputy",
    officeLabel: "Volkskammer Deputy",
    hook: "A party functionary with a place on the National Front list.",
    path: "Enter the 500-seat Volkskammer on the SED list. All seats are contested each cycle and there are no snap elections. The General Secretary appoints ministers straight from Volkskammer deputies, so a Council of Ministers portfolio is the next rung; Land First Secretary (+2 actions) and the General Secretaryship itself (+4) sit above it. The SED holds roughly 290 of 500 seats and a 3.0 vote multiplier: the majority is never in doubt, the contest is inside the party.",
  },
  {
    countryId: "DD",
    title: "The bloc-party deputy",
    officeType: "volkskammerDeputy",
    officeLabel: "Volkskammer Deputy",
    hook: "A CDU, LDPD, NDPD or DBD member. Allied, approved, never in charge.",
    path: "The four bloc parties hold about 50 to 55 Volkskammer seats each at the approved tier: you can hold your seat, propose and vote on bills, take donations and sit in cabinet, but your party cannot form government or field an executive candidate, and its votes weigh 0.375 against the SED's 3.0. Play the margins: shape legislation, take a ministry, and position yourself for the day the regime liberalizes or collapses toward a parliamentary republic.",
  },
];

/** Scenarios for one bloc country, in authored order. */
export function getPlayerStartScenarios(countryId: "RU" | "DD"): readonly PlayerStartScenario[] {
  return PLAYER_START_SCENARIOS.filter((scenario) => scenario.countryId === countryId);
}
