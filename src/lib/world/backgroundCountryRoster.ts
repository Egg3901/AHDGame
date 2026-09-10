import { ALIGNMENT_ROSTER, existsAt, statusAt } from "@/lib/constants/alignmentRoster";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import type {
  WorldEntityManifestEntry,
  WorldEntityPresetManifest,
  WorldEntityRegion,
} from "./worldEntityManifest";

/**
 * Sovereign polities missing from the 1953-oriented alignment catalogue.
 * Years describe the first January preset in which the state is independently
 * simulated. The 1991 preset deliberately retains the USSR/Yugoslavia because
 * it starts before their end-of-year dissolutions.
 */
const SUCCESSOR_POLITIES = [
  ["VN", "Vietnam", 1976, "asia", ["704"]],
  ["BD", "Bangladesh", 1972, "asia", ["050"]],
  ["AE", "United Arab Emirates", 1972, "asia", ["784"]],
  ["TZ", "Tanzania", 1965, "africa", ["834"]],
  ["MV", "Maldives", 1966, "asia", ["462"]],
  ["MU", "Mauritius", 1969, "africa", ["480"]],
  ["GD", "Grenada", 1975, "americas", ["308"]],
  ["KM", "Comoros", 1976, "africa", ["174"]],
  ["SC", "Seychelles", 1977, "africa", ["690"]],
  ["DM", "Dominica", 1979, "americas", ["212"]],
  ["LC", "Saint Lucia", 1980, "americas", ["662"]],
  ["VC", "Saint Vincent and the Grenadines", 1980, "americas", ["670"]],
  ["KI", "Kiribati", 1980, "pacific", ["296"]],
  ["TV", "Tuvalu", 1979, "pacific", ["798"]],
  ["ZW", "Zimbabwe", 1980, "africa", ["716"]],
  ["VU", "Vanuatu", 1981, "pacific", ["548"]],
  ["AG", "Antigua and Barbuda", 1982, "americas", ["028"]],
  ["BZ", "Belize", 1982, "americas", ["084"]],
  ["KN", "Saint Kitts and Nevis", 1984, "americas", ["659"]],
  ["FM", "Micronesia", 1987, "pacific", ["583"]],
  ["MH", "Marshall Islands", 1987, "pacific", ["584"]],
  ["NA", "Namibia", 1991, "africa", ["516"]],
  ["YEM", "Yemen", 1991, "asia", ["887"]],
  ["AM", "Armenia", 1992, "asia", ["051"]],
  ["AZ", "Azerbaijan", 1992, "asia", ["031"]],
  ["EE", "Estonia", 1992, "europe", ["233"]],
  ["GE", "Georgia", 1992, "asia", ["268"]],
  ["KZ", "Kazakhstan", 1992, "asia", ["398"]],
  ["KG", "Kyrgyzstan", 1992, "asia", ["417"]],
  ["LV", "Latvia", 1992, "europe", ["428"]],
  ["LT", "Lithuania", 1992, "europe", ["440"]],
  ["MD", "Moldova", 1992, "europe", ["498"]],
  ["TJ", "Tajikistan", 1992, "asia", ["762"]],
  ["TM", "Turkmenistan", 1992, "asia", ["795"]],
  ["UZ", "Uzbekistan", 1992, "asia", ["860"]],
  ["SI", "Slovenia", 1992, "europe", ["705"]],
  ["HR", "Croatia", 1992, "europe", ["191"]],
  ["YF", "Federal Republic of Yugoslavia", 1992, "europe", ["688", "499"]],
  ["BA", "Bosnia and Herzegovina", 1993, "europe", ["070"]],
  ["MK", "North Macedonia", 1993, "europe", ["807"]],
  ["CZ2", "Czechia", 1993, "europe", ["203"]],
  ["SK", "Slovakia", 1993, "europe", ["703"]],
  ["ER", "Eritrea", 1994, "africa", ["232"]],
  ["PW", "Palau", 1995, "pacific", ["585"]],
  ["TL", "Timor-Leste", 2003, "asia", ["626"]],
  ["RS", "Serbia", 2007, "europe", ["688"]],
  ["ME", "Montenegro", 2007, "europe", ["499"]],
  ["SS", "South Sudan", 2012, "africa", ["728"]],
] as const satisfies readonly (readonly [
  string,
  string,
  number,
  WorldEntityRegion,
  readonly string[],
])[];

const DISSOLVED_FROM: Readonly<Record<string, number>> = {
  DD: 1992,
  CS: 1993,
  YU: 1992,
  NVN: 1976,
  SVN: 1976,
  YE: 1991,
  YD: 1991,
  TTPI: 1987,
  TRE: 1972,
  BAL: 1992,
};

const SUCCESSOR_DISSOLVED_FROM: Readonly<Record<string, number>> = { YF: 2007 };

const REGION_KEYS: Readonly<Record<WorldEntityRegion, ReadonlySet<string>>> = {
  europe: new Set([
    "AD",
    "AL",
    "AT",
    "BE",
    "BG",
    "CH",
    "CS",
    "DD",
    "DE",
    "DK",
    "ES",
    "FI",
    "FR",
    "GR",
    "HU",
    "IE",
    "IS",
    "IT",
    "LI",
    "LU",
    "MC",
    "MT",
    "NL",
    "NO",
    "PL",
    "PT",
    "RO",
    "RU",
    "SE",
    "SM",
    "UK",
    "VA",
    "YU",
  ]),
  americas: new Set([
    "AR",
    "BB",
    "BO",
    "BR",
    "BS",
    "CA",
    "CL",
    "CO",
    "CR",
    "CU",
    "DO",
    "EC",
    "GT",
    "GY",
    "HN",
    "HT",
    "JM",
    "MX",
    "NI",
    "PA",
    "PE",
    "PY",
    "SRH",
    "SV",
    "TT",
    "US",
    "UY",
    "VE",
  ]),
  africa: new Set([
    "AO",
    "CD",
    "CI",
    "CV",
    "DZ",
    "EG",
    "EQG",
    "ET",
    "GA",
    "GH",
    "GM",
    "GN",
    "GW",
    "KE",
    "LR",
    "LY",
    "MA",
    "MG",
    "MR",
    "MZ",
    "NE",
    "NG",
    "SD",
    "SL",
    "SN",
    "SO",
    "STP",
    "SWA",
    "SWZ",
    "TD",
    "TN",
    "UG",
    "UV",
    "ZA",
  ]),
  pacific: new Set(["AU", "FJ", "NAU", "NZ", "PNG", "SB", "TO", "WS"]),
  asia: new Set(),
};

function regionFor(key: string): WorldEntityRegion {
  for (const [region, keys] of Object.entries(REGION_KEYS) as [
    WorldEntityRegion,
    ReadonlySet<string>,
  ][]) {
    if (keys.has(key)) return region;
  }
  return "asia";
}

function backgroundEntry(args: {
  presetId: string;
  entityId: string;
  displayName: string;
  region: WorldEntityRegion;
  mapFeatureIds?: readonly string[];
}): WorldEntityManifestEntry {
  return {
    entityId: args.entityId,
    presetId: args.presetId,
    displayName: args.displayName,
    status: "sovereign",
    region: args.region,
    simulationTier: "background-macro",
    economicArchetype: "macro",
    sphere: { canSponsor: false, relationships: [] },
    lifecycle: { transitionRuleIds: [] },
    recognition: { status: "widely-recognized" },
    un: { state: "eligible" },
    mapFeatureIds: args.mapFeatureIds ? [...args.mapFeatureIds] : undefined,
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: [
        "Background countries simulate aggregate economics only; domestic institutions are not seeded.",
      ],
      flavorGaps: [],
    },
    legacyAccess: "hidden",
  };
}

/** Promote every era-valid sovereign not already simulated at a higher tier. */
export function expandManifestWithBackgroundCountries(
  manifest: WorldEntityPresetManifest
): WorldEntityManifestEntry[] {
  const year = getStartingYearForPreset(manifest.presetId);
  const byId = new Map(manifest.entries.map((entry) => [entry.entityId, entry]));

  // Existing sovereign historical rows become live aggregate simulations.
  for (const [id, entry] of byId) {
    const dissolved = DISSOLVED_FROM[id];
    if (dissolved != null && year >= dissolved) {
      byId.set(id, {
        ...entry,
        status: "dissolved",
        simulationTier: "historical-presence",
        economicArchetype: "none",
      });
    } else if (entry.status === "sovereign" && entry.simulationTier === "historical-presence") {
      byId.set(id, { ...entry, simulationTier: "background-macro", economicArchetype: "macro" });
    }
  }

  for (const row of ALIGNMENT_ROSTER) {
    if (!existsAt(row.key, year) || statusAt(row.key, year) !== "sovereign") continue;
    const dissolved = DISSOLVED_FROM[row.key];
    if (dissolved != null && year >= dissolved) continue;
    if (byId.has(row.key)) continue;
    byId.set(
      row.key,
      backgroundEntry({
        presetId: manifest.presetId,
        entityId: row.key,
        displayName: row.name,
        region: regionFor(row.key),
        mapFeatureIds: row.iso,
      })
    );
  }

  for (const [entityId, displayName, starts, region, mapFeatureIds] of SUCCESSOR_POLITIES) {
    const dissolved = SUCCESSOR_DISSOLVED_FROM[entityId];
    if (year < starts || (dissolved != null && year >= dissolved) || byId.has(entityId)) continue;
    byId.set(
      entityId,
      backgroundEntry({
        presetId: manifest.presetId,
        entityId,
        displayName,
        region,
        mapFeatureIds,
      })
    );
  }
  return [...byId.values()];
}
