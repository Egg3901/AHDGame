/**
 * Every nation alignment may be authored for — a superset of CountryId, taken
 * verbatim from the ops 1953 seed-readiness report
 * (internal 1953 seed-readiness report). Implemented
 * countries reuse their CountryId spelling, so the key narrows to CountryId by
 * a plain membership check with no translation table; the rest use the
 * project's own historical entity ids (NVN, SVN, YE, MM, TANG, ...).
 *
 * Authoring deliberately covers nations the game does not implement yet, so
 * adding a country later is a COUNTRY_CONFIGS change with no alignment content
 * pass. Unimplemented entries are inert data — they never get a document.
 *
 * GENERATED from the ops report, then RECONCILED against the canonical world
 * entity manifest, which owns tier, status and the administering power. The
 * literal is kept rather than derived because `AlignmentCountryKey` has to be a
 * literal union — a type cannot be computed from runtime data — and deriving
 * the entries would force an unchecked cast on every key. `alignmentRoster.test`
 * holds the two in agreement instead, so manifest drift fails the build.
 *
 * Map geometry stays roster-owned: the manifest leaves `mapFeatureIds` empty for
 * playable countries, so neither side is complete on its own.
 *
 * Client-safe: no db imports.
 */
import { COUNTRY_CONFIGS, type CountryId } from "./countries";

export type AlignmentCountryKey =
  | "AD"
  | "ADN"
  | "AF"
  | "AL"
  | "AO"
  | "AR"
  | "AS"
  | "AT"
  | "AU"
  | "BAL"
  | "BAS"
  | "BB"
  | "BC"
  | "BCU"
  | "BE"
  | "BG"
  | "BH"
  | "BHN"
  | "BLR"
  | "UKR"
  | "BM"
  | "BN"
  | "BO"
  | "BR"
  | "BRG"
  | "BS"
  | "BT"
  | "CA"
  | "CD"
  | "CE"
  | "CH"
  | "CI"
  | "CK"
  | "CL"
  | "CMB"
  | "CMF"
  | "CN"
  | "CO"
  | "CR"
  | "CS"
  | "CU"
  | "CV"
  | "CY"
  | "CZ"
  | "DD"
  | "DE"
  | "DK"
  | "DO"
  | "DY"
  | "DZ"
  | "EC"
  | "EG"
  | "EQG"
  | "ES"
  | "ESH"
  | "ESH2"
  | "ET"
  | "FA"
  | "FI"
  | "FJ"
  | "FK"
  | "FO"
  | "FR"
  | "FSD"
  | "FSOM"
  | "FTT"
  | "GA"
  | "GC"
  | "GF"
  | "GH"
  | "GI"
  | "GL"
  | "GM"
  | "GN"
  | "GP"
  | "GR"
  | "GT"
  | "GU"
  | "GW"
  | "GY"
  | "HK"
  | "HN"
  | "HT"
  | "HU"
  | "ID"
  | "IE"
  | "IL"
  | "IN"
  | "IQ"
  | "IR"
  | "IS"
  | "IT"
  | "JM"
  | "JO"
  | "JP"
  | "KE"
  | "KH"
  | "KP"
  | "KR"
  | "KW"
  | "LA"
  | "LB"
  | "LI"
  | "LR"
  | "LU"
  | "LY"
  | "MA"
  | "MC"
  | "MCG"
  | "MG"
  | "MLY"
  | "MM"
  | "MN"
  | "MO"
  | "MQ"
  | "MR"
  | "MT"
  | "MX"
  | "MZ"
  | "NAU"
  | "NC"
  | "NE"
  | "NG"
  | "NH"
  | "NI"
  | "NL"
  | "NO"
  | "NP"
  | "NRH"
  | "NVN"
  | "NYA"
  | "NZ"
  | "OM"
  | "PA"
  | "PE"
  | "PF"
  | "PH"
  | "PK"
  | "PL"
  | "PM"
  | "PNG"
  | "POA"
  | "PR"
  | "PS"
  | "PT"
  | "PY"
  | "QA"
  | "RO"
  | "RU"
  | "RUA"
  | "SA"
  | "SAAR"
  | "SB"
  | "SCO"
  | "SD"
  | "SE"
  | "SG"
  | "SL"
  | "SM"
  | "SN"
  | "SO"
  | "SRH"
  | "ST"
  | "STP"
  | "SUR"
  | "SV"
  | "SVN"
  | "SWA"
  | "SWZ"
  | "SY"
  | "TANG"
  | "TD"
  | "TGB"
  | "TGF"
  | "TH"
  | "TN"
  | "TNG"
  | "TO"
  | "TP"
  | "TR"
  | "TRE"
  | "TT"
  | "TTPI"
  | "TW"
  | "UB"
  | "UG"
  | "UK"
  | "US"
  | "UV"
  | "UY"
  | "VA"
  | "VE"
  | "VI"
  | "WAL"
  | "WS"
  | "YD"
  | "YE"
  | "YU"
  | "ZA"
  | "ZNZ";

export type AlignmentTier = "full-autonomous" | "sphere-macro" | "historical-presence";
export type AlignmentEntityStatus = "sovereign" | "dependent" | "emergent";

export interface AlignmentRosterEntry {
  key: AlignmentCountryKey;
  name: string;
  tier: AlignmentTier;
  /** Status at the 1953 baseline; `statusAt` ages it forward. */
  status1953: AlignmentEntityStatus;
  /** ISO-numeric polygons this entity paints. Empty = no Natural Earth geometry. */
  iso: string[];
  /** Colonial metropole, for the seeding derive rule. Null when sovereign. */
  metro: AlignmentCountryKey | null;
}

export const ALIGNMENT_ROSTER: readonly AlignmentRosterEntry[] = [
  {
    key: "BG",
    name: "Bulgaria",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["100"],
    metro: null,
  },
  {
    key: "CMF",
    name: "French Cameroun",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["120"],
    metro: "FR",
  },
  {
    key: "CA",
    name: "Canada",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["124"],
    metro: null,
  },
  {
    key: "CV",
    name: "Cape Verde",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["132"],
    metro: "PT",
  },
  {
    key: "UB",
    name: "Ubangi-Shari",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["140"],
    metro: "FR",
  },
  {
    key: "CE",
    name: "Ceylon",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["144"],
    metro: null,
  },
  {
    key: "TD",
    name: "Chad",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["148"],
    metro: "FR",
  },
  {
    key: "CN",
    name: "China",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["156"],
    metro: null,
  },
  {
    key: "TW",
    name: "Taiwan",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["158"],
    metro: null,
  },
  {
    key: "CO",
    name: "Colombia",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["170"],
    metro: null,
  },
  {
    key: "MCG",
    name: "Middle Congo",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["178"],
    metro: "FR",
  },
  {
    key: "BC",
    name: "Belgian Congo",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["180"],
    metro: "BE",
  },
  {
    key: "CK",
    name: "Cook Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["184"],
    metro: "NZ",
  },
  {
    key: "CR",
    name: "Costa Rica",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["188"],
    metro: null,
  },
  {
    key: "CY",
    name: "Cyprus",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["196"],
    metro: "UK",
  },
  {
    key: "DY",
    name: "Dahomey",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["204"],
    metro: "FR",
  },
  {
    key: "DK",
    name: "Denmark",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["208"],
    metro: null,
  },
  {
    key: "DO",
    name: "Dominican Republic",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["214"],
    metro: null,
  },
  {
    key: "EC",
    name: "Ecuador",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["218"],
    metro: null,
  },
  {
    key: "SV",
    name: "El Salvador",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["222"],
    metro: null,
  },
  {
    key: "EQG",
    name: "Spanish Guinea",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["226"],
    metro: "ES",
  },
  {
    key: "FO",
    name: "Faroe Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["234"],
    metro: "DK",
  },
  {
    key: "FK",
    name: "Falkland Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["238"],
    metro: "UK",
  },
  {
    key: "FJ",
    name: "Fiji",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["242"],
    metro: "UK",
  },
  {
    key: "FI",
    name: "Finland",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["246"],
    metro: null,
  },
  {
    key: "FR",
    name: "France",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["250"],
    metro: null,
  },
  {
    key: "GF",
    name: "French Guiana",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["254"],
    metro: "FR",
  },
  {
    key: "PF",
    name: "French Polynesia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["258"],
    metro: "FR",
  },
  {
    key: "FSOM",
    name: "French Somaliland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["262"],
    metro: "FR",
  },
  {
    key: "GA",
    name: "Gabon",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["266"],
    metro: "FR",
  },
  {
    key: "GM",
    name: "Gambia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["270"],
    metro: "UK",
  },
  {
    key: "DE",
    name: "West Germany",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["276"],
    metro: null,
  },
  {
    key: "GH",
    name: "Ghana",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["288"],
    metro: null,
  },
  {
    key: "GI",
    name: "Gibraltar",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["292"],
    metro: "UK",
  },
  {
    key: "GR",
    name: "Greece",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["300"],
    metro: null,
  },
  {
    key: "GL",
    name: "Greenland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["304"],
    metro: "DK",
  },
  {
    key: "GP",
    name: "Guadeloupe",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["312"],
    metro: "FR",
  },
  {
    key: "GU",
    name: "Guam",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["316"],
    metro: "US",
  },
  {
    key: "GN",
    name: "French Guinea",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["324"],
    metro: "FR",
  },
  {
    key: "GY",
    name: "Guyana",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["328"],
    metro: null,
  },
  {
    key: "HT",
    name: "Haiti",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["332"],
    metro: null,
  },
  {
    key: "VA",
    name: "Vatican City",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["336"],
    metro: null,
  },
  {
    key: "HN",
    name: "Honduras",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["340"],
    metro: null,
  },
  {
    key: "HK",
    name: "Hong Kong",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["344"],
    metro: "UK",
  },
  {
    key: "HU",
    name: "Hungary",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["348"],
    metro: null,
  },
  {
    key: "IS",
    name: "Iceland",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["352"],
    metro: null,
  },
  {
    key: "IN",
    name: "India",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["356"],
    metro: null,
  },
  {
    key: "ID",
    name: "Indonesia",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["360"],
    metro: null,
  },
  {
    key: "IR",
    name: "Iran",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["364"],
    metro: null,
  },
  {
    key: "IQ",
    name: "Iraq",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["368"],
    metro: null,
  },
  {
    key: "IE",
    name: "Ireland",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["372"],
    metro: null,
  },
  {
    key: "IL",
    name: "Israel",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["376"],
    metro: null,
  },
  {
    key: "IT",
    name: "Italy",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["380"],
    metro: null,
  },
  {
    key: "CI",
    name: "Ivory Coast",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["384"],
    metro: "FR",
  },
  {
    key: "JM",
    name: "Jamaica",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["388"],
    metro: "UK",
  },
  {
    key: "JP",
    name: "Japan",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["392"],
    metro: null,
  },
  {
    key: "KE",
    name: "Kenya",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["404"],
    metro: "UK",
  },
  {
    key: "KP",
    name: "North Korea",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["408"],
    metro: null,
  },
  {
    key: "KR",
    name: "South Korea",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["410"],
    metro: null,
  },
  {
    key: "KW",
    name: "Kuwait",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["414"],
    metro: "UK",
  },
  {
    key: "LB",
    name: "Lebanon",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["422"],
    metro: null,
  },
  {
    key: "BAS",
    name: "Basutoland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["426"],
    metro: "UK",
  },
  {
    key: "LR",
    name: "Liberia",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["430"],
    metro: null,
  },
  {
    key: "LY",
    name: "Libya",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["434"],
    metro: null,
  },
  {
    key: "LI",
    name: "Liechtenstein",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["438"],
    metro: null,
  },
  {
    key: "LU",
    name: "Luxembourg",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["442"],
    metro: null,
  },
  {
    key: "MO",
    name: "Macau",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["446"],
    metro: "PT",
  },
  {
    key: "MG",
    name: "Madagascar",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["450"],
    metro: "FR",
  },
  {
    key: "NYA",
    name: "Nyasaland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["454"],
    metro: "UK",
  },
  {
    key: "MLY",
    name: "Federation of Malaya",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["458"],
    metro: "UK",
  },
  {
    key: "FSD",
    name: "French Sudan",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["466"],
    metro: "FR",
  },
  {
    key: "MT",
    name: "Malta",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["470"],
    metro: "UK",
  },
  {
    key: "MQ",
    name: "Martinique",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["474"],
    metro: "FR",
  },
  {
    key: "MR",
    name: "Mauritania",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["478"],
    metro: "FR",
  },
  {
    key: "MC",
    name: "Monaco",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["492"],
    metro: null,
  },
  {
    key: "MN",
    name: "Mongolia",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["496"],
    metro: null,
  },
  {
    key: "MA",
    name: "French Morocco",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["504"],
    metro: "FR",
  },
  {
    key: "MZ",
    name: "Mozambique",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["508"],
    metro: null,
  },
  {
    key: "OM",
    name: "Muscat and Oman",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["512"],
    metro: null,
  },
  {
    key: "SWA",
    name: "South West Africa",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["516"],
    metro: "ZA",
  },
  {
    key: "NAU",
    name: "Nauru",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["520"],
    metro: "AU",
  },
  {
    key: "NP",
    name: "Nepal",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["524"],
    metro: null,
  },
  {
    key: "NL",
    name: "Netherlands",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["528"],
    metro: null,
  },
  {
    key: "NC",
    name: "New Caledonia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["540"],
    metro: "FR",
  },
  {
    key: "NH",
    name: "New Hebrides",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["548"],
    metro: "UK",
  },
  {
    key: "NZ",
    name: "New Zealand",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["554"],
    metro: null,
  },
  {
    key: "NE",
    name: "Niger",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["562"],
    metro: "FR",
  },
  {
    key: "NG",
    name: "Nigeria",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["566"],
    metro: null,
  },
  {
    key: "NO",
    name: "Norway",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["578"],
    metro: null,
  },
  {
    key: "PK",
    name: "Pakistan",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["586"],
    metro: null,
  },
  {
    key: "PNG",
    name: "Territory of Papua and New Guinea",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["598"],
    metro: "AU",
  },
  {
    key: "PY",
    name: "Paraguay",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["600"],
    metro: null,
  },
  {
    key: "PE",
    name: "Peru",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["604"],
    metro: null,
  },
  {
    key: "PH",
    name: "Philippines",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["608"],
    metro: null,
  },
  {
    key: "PL",
    name: "Poland",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["616"],
    metro: null,
  },
  {
    key: "PT",
    name: "Portugal",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["620"],
    metro: null,
  },
  {
    key: "GW",
    name: "Portuguese Guinea",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["624"],
    metro: "PT",
  },
  {
    key: "TP",
    name: "Portuguese Timor",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["626"],
    metro: "PT",
  },
  {
    key: "PR",
    name: "Puerto Rico",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["630"],
    metro: "US",
  },
  {
    key: "QA",
    name: "Qatar",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["634"],
    metro: "UK",
  },
  {
    key: "RO",
    name: "Romania",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["642"],
    metro: null,
  },
  {
    key: "RU",
    name: "Soviet Union",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["643"],
    metro: null,
  },
  {
    key: "SM",
    name: "San Marino",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["674"],
    metro: null,
  },
  {
    key: "STP",
    name: "São Tomé and Príncipe",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["678"],
    metro: "PT",
  },
  {
    key: "SA",
    name: "Saudi Arabia",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["682"],
    metro: null,
  },
  {
    key: "SN",
    name: "Senegal",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["686"],
    metro: "FR",
  },
  {
    key: "SL",
    name: "Sierra Leone",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["694"],
    metro: "UK",
  },
  {
    key: "SG",
    name: "Singapore",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["702"],
    metro: "UK",
  },
  {
    key: "SRH",
    name: "Southern Rhodesia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["716"],
    metro: "UK",
  },
  {
    key: "ES",
    name: "Spain",
    // Demoted on development by #3840 (working 1953 budgets). The manifest is the
    // source of truth for tier; this table follows it, and
    // `alignmentRoster.test.ts` fails the moment the two disagree — which is how
    // this drift surfaced on the merge rather than in a player's game.
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["724"],
    metro: null,
  },
  {
    key: "SD",
    name: "Anglo-Egyptian Sudan",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["729"],
    metro: "UK",
  },
  {
    key: "ESH2",
    name: "Spanish Sahara",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["732"],
    metro: "ES",
  },
  {
    key: "SUR",
    name: "Dutch Guiana",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["740"],
    metro: "NL",
  },
  {
    key: "SWZ",
    name: "Swaziland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["748"],
    metro: "UK",
  },
  {
    key: "SE",
    name: "Sweden",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["752"],
    metro: null,
  },
  {
    key: "CH",
    name: "Switzerland",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["756"],
    metro: null,
  },
  {
    key: "SY",
    name: "Syria",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["760"],
    metro: null,
  },
  {
    key: "TGF",
    name: "French Togoland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["768"],
    metro: "FR",
  },
  {
    key: "TO",
    name: "Tonga",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["776"],
    metro: "UK",
  },
  {
    key: "TT",
    name: "Trinidad and Tobago",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["780"],
    metro: "UK",
  },
  {
    key: "TRE",
    name: "Trucial States",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["784"],
    metro: "UK",
  },
  {
    key: "TN",
    name: "Tunisia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["788"],
    metro: "FR",
  },
  {
    key: "TR",
    name: "Turkey",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["792"],
    metro: null,
  },
  {
    key: "UG",
    name: "Uganda",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["800"],
    metro: "UK",
  },
  {
    key: "EG",
    name: "Egypt",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["818"],
    metro: null,
  },
  {
    key: "UK",
    name: "United Kingdom",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["826"],
    metro: null,
  },
  {
    key: "TANG",
    name: "Tanganyika",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["834"],
    metro: "UK",
  },
  {
    key: "US",
    name: "United States",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["840"],
    metro: null,
  },
  {
    key: "VI",
    name: "US Virgin Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["850"],
    metro: "US",
  },
  {
    key: "UV",
    name: "Upper Volta",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["854"],
    metro: "FR",
  },
  {
    key: "UY",
    name: "Uruguay",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["858"],
    metro: null,
  },
  {
    key: "WS",
    name: "Western Samoa",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["882"],
    metro: "NZ",
  },
  {
    key: "NRH",
    name: "Northern Rhodesia",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["894"],
    metro: "UK",
  },
  {
    key: "BR",
    name: "Brazil",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["076"],
    metro: null,
  },
  {
    key: "AT",
    name: "Austria",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: ["040"],
    metro: null,
  },
  {
    key: "DZ",
    name: "Algeria",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["012"],
    metro: null,
  },
  {
    key: "AO",
    name: "Angola",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["024"],
    metro: null,
  },
  {
    key: "AL",
    name: "Albania",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["008"],
    metro: null,
  },
  {
    key: "BE",
    name: "Belgium",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["056"],
    metro: null,
  },
  {
    key: "AD",
    name: "Andorra",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["020"],
    metro: null,
  },
  {
    key: "BO",
    name: "Bolivia",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["068"],
    metro: null,
  },
  {
    key: "BHN",
    name: "British Honduras",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["084"],
    metro: "UK",
  },
  {
    key: "BB",
    name: "Barbados",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["052"],
    metro: "UK",
  },
  {
    key: "BS",
    name: "Bahamas",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["044"],
    metro: "UK",
  },
  {
    key: "BM",
    name: "Bermuda",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["060"],
    metro: "UK",
  },
  {
    key: "BCU",
    name: "Bechuanaland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["072"],
    metro: "UK",
  },
  {
    key: "BT",
    name: "Bhutan",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["064"],
    metro: null,
  },
  {
    key: "BN",
    name: "Brunei",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["096"],
    metro: "UK",
  },
  {
    key: "BH",
    name: "Bahrain",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["048"],
    metro: "UK",
  },
  {
    key: "AU",
    name: "Australia",
    tier: "historical-presence",
    status1953: "sovereign",
    iso: ["036"],
    metro: null,
  },
  {
    key: "SB",
    name: "British Solomon Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["090"],
    metro: "UK",
  },
  {
    key: "AS",
    name: "American Samoa",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["016"],
    metro: "US",
  },
  {
    key: "DD",
    name: "East Germany",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: [],
    metro: null,
  },
  {
    key: "CS",
    name: "Czechoslovakia",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: [],
    metro: null,
  },
  {
    key: "YU",
    name: "Yugoslavia",
    tier: "full-autonomous",
    status1953: "sovereign",
    iso: [],
    metro: null,
  },
  {
    key: "JO",
    name: "Jordan",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["400"],
    metro: null,
  },
  {
    key: "AF",
    name: "Afghanistan",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["004"],
    metro: null,
  },
  {
    key: "YE",
    name: "North Yemen",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["887"],
    metro: null,
  },
  {
    key: "MM",
    name: "Burma",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["104"],
    metro: null,
  },
  {
    key: "LA",
    name: "Laos",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["418"],
    metro: null,
  },
  {
    key: "KH",
    name: "Cambodia",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["116"],
    metro: null,
  },
  {
    key: "TH",
    name: "Thailand",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["764"],
    metro: null,
  },
  {
    key: "ET",
    name: "Ethiopia",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["231"],
    metro: null,
  },
  {
    key: "ZA",
    name: "South Africa",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["710"],
    metro: null,
  },
  {
    key: "CU",
    name: "Cuba",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["192"],
    metro: null,
  },
  {
    key: "GT",
    name: "Guatemala",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["320"],
    metro: null,
  },
  {
    key: "PA",
    name: "Panama",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["591"],
    metro: null,
  },
  {
    key: "NI",
    name: "Nicaragua",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["558"],
    metro: null,
  },
  {
    key: "CL",
    name: "Chile",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["152"],
    metro: null,
  },
  {
    key: "AR",
    name: "Argentina",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["032"],
    metro: null,
  },
  {
    key: "MX",
    name: "Mexico",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["484"],
    metro: null,
  },
  {
    key: "VE",
    name: "Venezuela",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["862"],
    metro: null,
  },
  {
    key: "SO",
    name: "Somalia",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["706"],
    metro: null,
  },
  {
    key: "CD",
    name: "Congo",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["180"],
    metro: null,
  },
  {
    key: "YD",
    name: "South Yemen",
    tier: "sphere-macro",
    status1953: "emergent",
    iso: ["YD"],
    metro: null,
  },
  {
    key: "GC",
    name: "Gold Coast",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["288"],
    metro: "UK",
  },
  {
    key: "ST",
    name: "Somalia Trust Territories",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["706"],
    metro: "IT",
  },
  {
    key: "FA",
    name: "French Algeria",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["012"],
    metro: "FR",
  },
  {
    key: "BRG",
    name: "British Guiana",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["328"],
    metro: "UK",
  },
  {
    key: "ADN",
    name: "Aden Protectorate",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["ADN"],
    metro: "UK",
  },
  {
    key: "POA",
    name: "Portuguese Angola",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["024"],
    metro: "PT",
  },
  {
    key: "PM",
    name: "Portuguese Mozambique",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["508"],
    metro: "PT",
  },
  {
    key: "SAAR",
    name: "Saar Protectorate",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["SAAR"],
    metro: "FR",
  },
  {
    key: "FTT",
    name: "Free Territory of Trieste",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["FTT"],
    metro: null,
  },
  {
    key: "CZ",
    name: "Panama Canal Zone",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["CZ"],
    metro: "US",
  },
  {
    key: "ESH",
    name: "Spanish Morocco",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["ESH"],
    metro: "ES",
  },
  {
    key: "TNG",
    name: "Tangier International Zone",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["TNG"],
    metro: null,
  },
  {
    key: "CMB",
    name: "British Cameroons",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["CMB"],
    metro: "UK",
  },
  {
    key: "TGB",
    name: "British Togoland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["TGB"],
    metro: "UK",
  },
  {
    key: "ZNZ",
    name: "Zanzibar",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["ZNZ"],
    metro: "UK",
  },
  {
    key: "RUA",
    name: "Ruanda-Urundi",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["646", "108"],
    metro: "BE",
  },
  {
    key: "PS",
    name: "Palestinian territories",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["275"],
    metro: null,
  },
  {
    key: "TTPI",
    name: "Trust Territory of the Pacific Islands",
    tier: "historical-presence",
    status1953: "dependent",
    iso: ["TTPI"],
    metro: "US",
  },
  {
    key: "NVN",
    name: "North Vietnam",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["NVN"],
    metro: null,
  },
  {
    key: "SVN",
    name: "South Vietnam",
    tier: "sphere-macro",
    status1953: "sovereign",
    iso: ["SVN"],
    metro: null,
  },
  // The three western union republics run their own economies and chambers, so
  // they are full-autonomous like the satellites. They stay `dependent` in 1953
  // because they were constituent republics of the USSR, not sovereign states:
  // the tier says how much of the simulation they carry, `status1953` says who
  // they answer to, and for these three those are different answers.
  {
    key: "BLR",
    name: "Byelorussia",
    tier: "full-autonomous",
    status1953: "dependent",
    iso: ["112"],
    metro: "RU",
  },
  {
    key: "UKR",
    name: "Ukraine",
    tier: "full-autonomous",
    status1953: "dependent",
    iso: ["804"],
    metro: "RU",
  },
  {
    key: "BAL",
    name: "Baltic states",
    tier: "full-autonomous",
    status1953: "dependent",
    iso: ["440", "428", "233"],
    metro: "RU",
  },
  {
    key: "SCO",
    name: "Scotland",
    tier: "historical-presence",
    status1953: "dependent",
    iso: [],
    metro: "UK",
  },
  {
    key: "WAL",
    name: "Wales",
    tier: "historical-presence",
    status1953: "dependent",
    iso: [],
    metro: "UK",
  },
];

export const ROSTER_BY_KEY: Record<AlignmentCountryKey, AlignmentRosterEntry> = Object.fromEntries(
  ALIGNMENT_ROSTER.map((r) => [r.key, r])
) as Record<AlignmentCountryKey, AlignmentRosterEntry>;

/**
 * Adding a country to COUNTRY_CONFIGS with no roster entry must be a TYPE
 * ERROR, not a silent neutral seed. `noUncheckedIndexedAccess` is off in this
 * repo, so an index-signature lookup would never surface the gap — the check
 * has to be assignability against the literal key union.
 */
type _CountryIdsAreRostered = CountryId extends AlignmentCountryKey ? true : never;
const _countryIdsAreRostered: _CountryIdsAreRostered = true;
void _countryIdsAreRostered;

/** Colonial entities superseded by an emergent twin: present BEFORE this year. */
const ENDS: Record<string, number> = {
  ADN: 1967,
  BC: 1960,
  BRG: 1966,
  CMB: 1961,
  CMF: 1960,
  CZ: 1979,
  ESH: 1956,
  FA: 1962,
  FTT: 1954,
  GC: 1957,
  MA: 1956,
  MLY: 1963,
  NH: 1980,
  PM: 1975,
  POA: 1975,
  PS: 1967,
  RUA: 1962,
  SAAR: 1957,
  ST: 1960,
  SWA: 1990,
  TANG: 1961,
  TGB: 1957,
  TGF: 1960,
  TN: 1956,
  TNG: 1956,
  TTPI: 1986,
  ZNZ: 1964,
};

/** Entities that only begin at independence / creation: present FROM this year. */
const STARTS: Record<string, number> = {
  AO: 1975,
  CD: 1960,
  DZ: 1962,
  GH: 1957,
  GY: 1966,
  MZ: 1975,
  SO: 1960,
  YD: 1967,
};

/** Dependencies that become sovereign while keeping the same entity id. */
const INDEP: Record<string, number> = {
  // The three western union republics. Dependent on Moscow for as long as the
  // Union holds, sovereign from its dissolution: Lithuania declared in March
  // 1990 and the rest followed through 1991, and 1991 is the year every one of
  // them was recognised.
  UKR: 1991,
  BLR: 1991,
  BAL: 1991,
  BAS: 1966,
  BB: 1966,
  BCU: 1966,
  BH: 1971,
  BHN: 1981,
  BN: 1984,
  BS: 1973,
  CI: 1960,
  CV: 1975,
  CY: 1960,
  DY: 1960,
  EQG: 1968,
  ESH2: 1976,
  FJ: 1970,
  FSD: 1960,
  FSOM: 1977,
  GA: 1960,
  GM: 1965,
  GN: 1958,
  GW: 1974,
  JM: 1962,
  KE: 1963,
  KW: 1961,
  MCG: 1960,
  MG: 1960,
  MO: 1999,
  MR: 1960,
  MT: 1964,
  NAU: 1968,
  NE: 1960,
  NRH: 1964,
  NYA: 1964,
  PNG: 1975,
  QA: 1971,
  SB: 1978,
  SD: 1956,
  SG: 1965,
  SL: 1961,
  SN: 1960,
  SRH: 1965,
  STP: 1975,
  SUR: 1975,
  SWZ: 1968,
  TD: 1960,
  TO: 1970,
  TP: 1975,
  TRE: 1971,
  TT: 1962,
  UB: 1960,
  UG: 1962,
  UV: 1960,
  WS: 1962,
};

/** Whether an entity exists at all in a given year. */
export function existsAt(key: AlignmentCountryKey, year: number): boolean {
  const starts = STARTS[key];
  if (starts != null && year < starts) return false;
  const ends = ENDS[key];
  if (ends != null && year >= ends) return false;
  return true;
}

/** An entity's status in a given year — dependencies age into sovereignty. */
export function statusAt(key: AlignmentCountryKey, year: number): AlignmentEntityStatus {
  const entry = ROSTER_BY_KEY[key];
  if (!entry) return "sovereign";
  if (entry.status1953 !== "dependent") {
    // "emergent" describes a not-yet-born state; once it exists it is
    // sovereign, and existsAt is what gates its birth.
    return entry.status1953 === "emergent" ? "sovereign" : entry.status1953;
  }
  const y = INDEP[key];
  return y != null && year >= y ? "sovereign" : "dependent";
}

/** True when the key names a country the game actually implements. */
export function isLiveCountryKey(key: AlignmentCountryKey): key is CountryId & AlignmentCountryKey {
  return key in COUNTRY_CONFIGS;
}
