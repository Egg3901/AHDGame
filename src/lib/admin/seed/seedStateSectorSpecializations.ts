import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { CorporationType, StateSectorSpecialization } from "@/lib/constants/corporations";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

const US_OVERRIDES: Record<string, StateSectorSpecialization> = {
  AL: { primary: "manufacturing", secondary: "defense" },
  AK: { primary: "energy", secondary: "extraction" },
  AZ: { primary: "technology", secondary: "real_estate" },
  AR: { primary: "agriculture", secondary: "retail" },
  CA: { primary: "technology", secondary: "entertainment" },
  CO: { primary: "technology", secondary: "energy" },
  CT: { primary: "financial", secondary: "healthcare" },
  DE: { primary: "financial", secondary: "chemical_industries" },
  FL: { primary: "real_estate", secondary: "entertainment" },
  GA: { primary: "logistics", secondary: "telecommunications" },
  HI: { primary: "entertainment", secondary: "agriculture" },
  ID: { primary: "agriculture", secondary: "technology" },
  IL: { primary: "financial", secondary: "logistics" },
  IN: { primary: "manufacturing", secondary: "automobiles" },
  IA: { primary: "agriculture", secondary: "energy" },
  KS: { primary: "agriculture", secondary: "manufacturing" },
  KY: { primary: "manufacturing", secondary: "logistics" },
  LA: { primary: "energy", secondary: "chemical_industries" },
  ME: { primary: "agriculture", secondary: "healthcare" },
  MD: { primary: "defense", secondary: "healthcare" },
  MA: { primary: "technology", secondary: "healthcare" },
  MI: { primary: "automobiles", secondary: "manufacturing" },
  MN: { primary: "healthcare", secondary: "financial" },
  MS: { primary: "agriculture", secondary: "manufacturing" },
  MO: { primary: "logistics", secondary: "agriculture" },
  MT: { primary: "agriculture", secondary: "extraction" },
  NE: { primary: "agriculture", secondary: "financial" },
  NV: { primary: "entertainment", secondary: "real_estate" },
  NH: { primary: "technology", secondary: "financial" },
  NJ: { primary: "chemical_industries", secondary: "telecommunications" },
  NM: { primary: "energy", secondary: "defense" },
  NY: { primary: "financial", secondary: "media" },
  NC: { primary: "financial", secondary: "technology" },
  ND: { primary: "energy", secondary: "agriculture" },
  OH: { primary: "manufacturing", secondary: "healthcare" },
  OK: { primary: "energy", secondary: "agriculture" },
  OR: { primary: "technology", secondary: "agriculture" },
  PA: { primary: "healthcare", secondary: "energy" },
  RI: { primary: "healthcare", secondary: "financial" },
  SC: { primary: "manufacturing", secondary: "automobiles" },
  SD: { primary: "financial", secondary: "agriculture" },
  TN: { primary: "healthcare", secondary: "entertainment" },
  TX: { primary: "energy", secondary: "technology" },
  UT: { primary: "technology", secondary: "financial" },
  VT: { primary: "agriculture", secondary: "healthcare" },
  VA: { primary: "defense", secondary: "technology" },
  WA: { primary: "technology", secondary: "logistics" },
  WV: { primary: "extraction", secondary: "energy" },
  WI: { primary: "manufacturing", secondary: "agriculture" },
  WY: { primary: "energy", secondary: "extraction" },
  DC: { primary: "media", secondary: "financial" },
};

const COUNTRY_DEFAULTS: Record<string, StateSectorSpecialization> = {
  US: { primary: "manufacturing", secondary: "retail" },
  UK: { primary: "financial", secondary: "media" },
  JP: { primary: "automobiles", secondary: "technology" },
  DE: { primary: "manufacturing", secondary: "automobiles" },
  IE: { primary: "technology", secondary: "financial" },
  BR: { primary: "agriculture", secondary: "energy" },
  CN: { primary: "manufacturing", secondary: "technology" },
  NG: { primary: "energy", secondary: "agriculture" },
};

const REGIONAL_OVERRIDES: Record<string, StateSectorSpecialization> = {
  "UK:LON": { primary: "financial", secondary: "media" },
  "UK:SEE": { primary: "technology", secondary: "financial" },
  "UK:SWE": { primary: "technology", secondary: "defense" },
  "UK:EAE": { primary: "technology", secondary: "agriculture" },
  "UK:EMI": { primary: "manufacturing", secondary: "logistics" },
  "UK:WMI": { primary: "automobiles", secondary: "manufacturing" },
  "UK:YHU": { primary: "manufacturing", secondary: "logistics" },
  "UK:NWE": { primary: "media", secondary: "manufacturing" },
  "UK:NEE": { primary: "energy", secondary: "manufacturing" },
  "UK:SCO": { primary: "extraction", secondary: "energy" },
  "UK:WAL": { primary: "manufacturing", secondary: "energy" },
  "UK:NIR": { primary: "agriculture", secondary: "manufacturing" },

  "DE:BW": { primary: "automobiles", secondary: "manufacturing" },
  "DE:BY": { primary: "automobiles", secondary: "manufacturing" },
  "DE:NW": { primary: "manufacturing", secondary: "chemical_industries" },
  "DE:HE": { primary: "financial", secondary: "logistics" },
  "DE:RP": { primary: "chemical_industries", secondary: "manufacturing" },
  "DE:SL": { primary: "automobiles", secondary: "manufacturing" },
  "DE:NI": { primary: "automobiles", secondary: "manufacturing" },
  "DE:SH": { primary: "energy", secondary: "logistics" },
  "DE:HH": { primary: "logistics", secondary: "financial" },
  "DE:HB": { primary: "logistics", secondary: "automobiles" },
  "DE:BE": { primary: "technology", secondary: "media" },
  "DE:BB": { primary: "energy", secondary: "agriculture" },
  "DE:MV": { primary: "agriculture", secondary: "energy" },
  "DE:SN": { primary: "technology", secondary: "manufacturing" },
  "DE:ST": { primary: "chemical_industries", secondary: "energy" },
  "DE:TH": { primary: "manufacturing", secondary: "technology" },

  "JP:HOK": { primary: "agriculture", secondary: "energy" },
  "JP:TOH": { primary: "manufacturing", secondary: "energy" },
  "JP:KAN": { primary: "financial", secondary: "technology" },
  "JP:CHU": { primary: "automobiles", secondary: "manufacturing" },
  "JP:KNS": { primary: "manufacturing", secondary: "technology" },
  "JP:CGK": { primary: "automobiles", secondary: "manufacturing" },
  "JP:SHI": { primary: "agriculture", secondary: "chemical_industries" },
  "JP:KYU": { primary: "automobiles", secondary: "manufacturing" },

  "CN:DB": { primary: "manufacturing", secondary: "energy" },
  "CN:HB": { primary: "financial", secondary: "technology" },
  "CN:HD": { primary: "technology", secondary: "manufacturing" },
  "CN:HZ": { primary: "manufacturing", secondary: "agriculture" },
  "CN:HN": { primary: "technology", secondary: "telecommunications" },
  "CN:XN": { primary: "energy", secondary: "agriculture" },
  "CN:XB": { primary: "energy", secondary: "extraction" },

  "IE:DUB": { primary: "technology", secondary: "telecommunications" },
  "IE:KIL": { primary: "real_estate", secondary: "construction" },
  "IE:MID": { primary: "healthcare", secondary: "agriculture" },
  "IE:WEX": { primary: "manufacturing", secondary: "agriculture" },
  "IE:LIM": { primary: "chemical_industries", secondary: "technology" },
  "IE:COR": { primary: "chemical_industries", secondary: "technology" },
  "IE:GAL": { primary: "chemical_industries", secondary: "healthcare" },
  "IE:DON": { primary: "healthcare", secondary: "agriculture" },

  "BR:NORTE": { primary: "extraction", secondary: "agriculture" },
  "BR:NORDESTE": { primary: "energy", secondary: "agriculture" },
  "BR:CENTRO_OESTE": { primary: "agriculture", secondary: "logistics" },
  "BR:SUDESTE": { primary: "financial", secondary: "manufacturing" },
  "BR:SUL": { primary: "agriculture", secondary: "manufacturing" },

  "NG:NORTH_WEST": { primary: "agriculture", secondary: "manufacturing" },
  "NG:NORTH_EAST": { primary: "agriculture", secondary: "energy" },
  "NG:NORTH_CENTRAL": { primary: "agriculture", secondary: "logistics" },
  "NG:SOUTH_WEST": { primary: "technology", secondary: "financial" },
  "NG:SOUTH_SOUTH": { primary: "energy", secondary: "extraction" },
  "NG:SOUTH_EAST": { primary: "manufacturing", secondary: "technology" },
};

function rotateFallback(stateId: string): StateSectorSpecialization {
  const chars = [...stateId];
  const hash = chars.reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const primary = CORPORATION_TYPES[hash % CORPORATION_TYPES.length];
  let secondary = CORPORATION_TYPES[(hash + 5) % CORPORATION_TYPES.length];
  if (secondary === primary) secondary = CORPORATION_TYPES[(hash + 6) % CORPORATION_TYPES.length];
  return { primary, secondary };
}

function byKeyword(state: State): StateSectorSpecialization | null {
  const haystack = `${state._id} ${state.name} ${state.region}`.toLowerCase();
  const match = (terms: string[]) => terms.some((term) => haystack.includes(term));

  if (match(["london", "new york", "tokyo", "frankfurt"])) {
    return { primary: "financial", secondary: "media" };
  }
  if (match(["bavaria", "baden", "aichi", "osaka", "são paulo", "sao paulo"])) {
    return { primary: "manufacturing", secondary: "automobiles" };
  }
  if (match(["texas", "alberta", "hokkaido", "rheinland", "north sea", "northeast"])) {
    return { primary: "energy", secondary: "extraction" };
  }
  if (match(["california", "washington", "berlin", "leinster", "shanghai", "beijing"])) {
    return { primary: "technology", secondary: "media" };
  }
  if (match(["midwest", "plains", "wales", "scotland", "ireland", "rural"])) {
    return { primary: "agriculture", secondary: "energy" };
  }
  if (match(["south", "southeast", "northern ireland", "kyushu"])) {
    return { primary: "manufacturing", secondary: "logistics" };
  }
  if (match(["west", "mountain", "northwest"])) {
    return { primary: "technology", secondary: "real_estate" };
  }
  return null;
}

export function inferStateSectorSpecialization(state: State): StateSectorSpecialization {
  if (state.countryId === "US" && US_OVERRIDES[state._id]) return US_OVERRIDES[state._id];
  const explicit = REGIONAL_OVERRIDES[`${state.countryId}:${state._id}`];
  if (explicit) return explicit;
  return byKeyword(state) ?? COUNTRY_DEFAULTS[state.countryId] ?? rotateFallback(state._id);
}

export async function seedStateSectorSpecializations(
  db: Db,
  reset: boolean,
  log: (msg: string) => void
) {
  if (reset) {
    await db.collection<State>("states").updateMany({}, { $unset: { sectorSpecializations: "" } });
  }

  const states = await db.collection<State>("states").find({}).toArray();
  if (states.length === 0) {
    log("seedStateSectorSpecializations: no states found - run regional seeders first");
    return;
  }

  const now = new Date();
  const ops = states.map((state) => {
    const specialization = inferStateSectorSpecialization(state);
    return {
      updateOne: {
        filter: { _id: state._id },
        update: {
          $set: {
            "sectorSpecializations.primary": specialization.primary,
            "sectorSpecializations.secondary": specialization.secondary,
            "sectorSpecializations.updatedAt": now,
          },
        },
      },
    };
  });

  await db.collection<State>("states").bulkWrite(ops);

  const byPrimary = new Map<CorporationType, number>();
  for (const state of states) {
    const primary = inferStateSectorSpecialization(state).primary;
    byPrimary.set(primary, (byPrimary.get(primary) ?? 0) + 1);
  }
  const summary = [...byPrimary.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sector, count]) => `${sector}:${count}`)
    .join(", ");

  log(`Seeded sector specializations for ${states.length} states/regions (${summary})`);
}
