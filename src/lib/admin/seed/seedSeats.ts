import type { Db } from "mongodb";
import type { Seat } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { buildSeatId, getLocalRegionId } from "@/lib/seats";
import { SENATE_CLASSES, getCnPeoplesCongressSeats } from "@/lib/constants";
import {
  STATE_IDS,
  JP_SHUGIIN_SEATS,
  JP_SANGIIN_SEATS,
  DE_WAHLKREIS_SEATS,
  getHouseSeats,
  getUkCommonsSeats,
} from "@/lib/constants/states";
import { JP_REGIONS } from "@/lib/constants/japan";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { TERRITORY_ADMISSIONS } from "@/lib/elections/statehoodAdmission";

// State name lookup for display names
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const UK_REGION_NAMES: Record<string, string> = {
  LON: "London",
  SEE: "South East",
  SWE: "South West",
  EAE: "East of England",
  WMI: "West Midlands",
  EMI: "East Midlands",
  YHU: "Yorkshire & Humber",
  NWE: "North West",
  NEE: "North East",
  WAL: "Wales",
  SCO: "Scotland",
  NIR: "Northern Ireland",
};

const JP_REGION_NAMES: Record<string, string> = Object.fromEntries(
  JP_REGIONS.map((r) => [r.id, r.name])
);
const DE_REGION_NAMES: Record<string, string> = Object.fromEntries(
  deRegions.map((r) => [r._id, r.name])
);

const BR_REGION_NAMES: Record<string, string> = Object.fromEntries(
  brRegions.map((r) => [r._id, r.name])
);
const NG_REGION_NAMES: Record<string, string> = Object.fromEntries(
  ngRegions.map((r) => [r._id, r.name])
);
const CN_REGION_NAMES: Record<string, string> = Object.fromEntries(
  cnRegions.map((r) => [r._id, r.name])
);
const IE_REGION_NAMES: Record<string, string> = Object.fromEntries(
  ieRegions.map((r) => [r._id, r.name])
);

/**
 * Per-region councillor seat allocation for the IE Local Council. Must mirror
 * `IE_LOCAL_COUNCIL_SEATS` in `src/lib/turn/perpetualElections.ts` — the
 * seed file is intentionally kept module-local to avoid a turn-system
 * import from the admin seed path (matches the UK_REGIONAL_COUNCIL_SEATS
 * duplication pattern).
 */
const IE_LOCAL_COUNCIL_SEATS_LOCAL: Record<string, number> = {
  DUB: 62,
  KIL: 26,
  COR: 25,
  DON: 21,
  GAL: 19,
  LIM: 18,
  WEX: 17,
  MID: 12,
};

const REGION_NAME_MAPS: Partial<Record<CountryId, Record<string, string>>> = {
  UK: UK_REGION_NAMES,
  JP: JP_REGION_NAMES,
  DE: DE_REGION_NAMES,
  BR: BR_REGION_NAMES,
  NG: NG_REGION_NAMES,
  CN: CN_REGION_NAMES,
  IE: IE_REGION_NAMES,
};

function getStateName(state: string, ctryId: CountryId): string {
  const regionMap = REGION_NAME_MAPS[ctryId];
  if (regionMap) return regionMap[state] ?? state;
  return STATE_NAMES[state] ?? state;
}

function getElectionTypeLabel(electionType: string): string {
  switch (electionType) {
    case "senate":
      return "Senate";
    case "house":
      return "House";
    case "governor":
      return "Governor";
    case "stateSenate":
      return "State Senate";
    case "president":
      return "President";
    case "commons":
      return "Commons";
    case "shugiin":
      return "Shugiin";
    case "sangiin":
      return "Sangiin";
    case "primeMinister":
      return "Prime Minister";
    case "bundestag":
      return "Bundestag";
    case "landtag":
      return "Landtag";
    case "chamber":
      return "Chamber";
    case "npcDelegate":
      return "NPC Delegates";
    case "peoplesCongress":
      return "People's Congress";
    case "dail":
      return "Dáil";
    case "seanad":
      return "Seanad";
    case "localCouncil":
      return "Local Council";
    default:
      return electionType;
  }
}

// IE per-region mayoral labels for the recycled `governor` electionType
// (Cathaoirleach). Mirrors the per-region branching in
// `getRegionalBillAssentTitleForState` and `getRegionalExecutive` so the
// admin/seat-listing surfaces carry the same labels players see.
function ieGovernorLabelForRegion(stateId: string): string {
  switch (stateId.toUpperCase()) {
    case "DUB":
      return "Lord Mayor of Dublin";
    case "COR":
      return "Lord Mayor of Cork";
    case "LIM":
      return "Mayor of Limerick";
    case "GAL":
      return "Mayor of Galway";
    default:
      return "Cathaoirleach";
  }
}

function buildDisplayName(
  countryId: CountryId,
  electionType: string,
  state: string,
  senateClass?: number
): string {
  if (electionType === "president") {
    return "U.S. President";
  }
  if (countryId === "IE" && electionType === "governor") {
    const stateName = getStateName(state, countryId);
    return `${stateName} — ${ieGovernorLabelForRegion(state)}`;
  }
  const stateName = getStateName(state, countryId);
  const typeLabel = getElectionTypeLabel(electionType);
  if (senateClass) {
    return `${stateName} ${typeLabel} (Class ${senateClass})`;
  }
  return `${stateName} ${typeLabel}`;
}

function buildShortName(
  countryId: CountryId,
  electionType: string,
  state: string,
  senateClass?: number
): string {
  if (electionType === "president") {
    return "President";
  }
  // For IE Cathaoirleach (recycled `governor`), use a 3-letter "Cth" tag
  // so the seat-listing short form reads "DUB Cth" rather than "DUB Gov".
  if (countryId === "IE" && electionType === "governor") {
    const localRegion = getLocalRegionId(state, countryId);
    return `${localRegion} Cth`;
  }
  const localRegion = getLocalRegionId(state, countryId);
  const shortType =
    electionType === "stateSenate"
      ? "StateSen"
      : electionType === "bundestag"
        ? "Btg"
        : electionType === "landtag"
          ? "Ltg"
          : electionType === "npcDelegate"
            ? "NPC"
            : electionType === "peoplesCongress"
              ? "PPC"
              : electionType === "localCouncil"
                ? "LC"
                : electionType.charAt(0).toUpperCase() + electionType.slice(1, 3);
  if (senateClass) {
    return `${localRegion} ${shortType}-${senateClass}`;
  }
  return `${localRegion} ${shortType}`;
}

/**
 * Every seat a single US state elects: House delegation, both Senate classes,
 * Governor and State Senate.
 *
 * Extracted so mid-game statehood admission creates exactly the same seat rows
 * a bootstrap would. `seedSeats` only runs at bootstrap/reset, so without a
 * shared builder an admitted state would hold elections against seats that do
 * not exist, and the two definitions would drift.
 */
export function buildUsStateSeats(stateId: string, houseSeats: number, now: Date): Seat[] {
  const seats: Seat[] = [];

  seats.push({
    _id: buildSeatId("US", "house", stateId),
    countryId: "US",
    electionType: "house",
    state: stateId,
    totalSeats: houseSeats,
    displayName: buildDisplayName("US", "house", stateId),
    shortName: buildShortName("US", "house", stateId),
    createdAt: now,
    updatedAt: now,
  });

  const classes = SENATE_CLASSES[stateId] ?? [1, 2];
  for (const cls of classes as (1 | 2 | 3)[]) {
    seats.push({
      _id: buildSeatId("US", "senate", stateId, cls),
      countryId: "US",
      electionType: "senate",
      state: stateId,
      senateClass: cls,
      displayName: buildDisplayName("US", "senate", stateId, cls),
      shortName: buildShortName("US", "senate", stateId, cls),
      createdAt: now,
      updatedAt: now,
    });
  }

  seats.push({
    _id: buildSeatId("US", "governor", stateId),
    countryId: "US",
    electionType: "governor",
    state: stateId,
    displayName: buildDisplayName("US", "governor", stateId),
    shortName: buildShortName("US", "governor", stateId),
    createdAt: now,
    updatedAt: now,
  });

  seats.push({
    _id: buildSeatId("US", "stateSenate", stateId),
    countryId: "US",
    electionType: "stateSenate",
    state: stateId,
    displayName: buildDisplayName("US", "stateSenate", stateId),
    shortName: buildShortName("US", "stateSenate", stateId),
    createdAt: now,
    updatedAt: now,
  });

  return seats;
}

/**
 * The sole elected office in an unadmitted US territory. Territorial governors
 * are deliberately represented by the existing governor election family, so
 * candidacy, election resolution, and executive powers use the established
 * path. House, Senate, and state-Senate seats are only added on admission by
 * {@link buildUsStateSeats}.
 */
export function buildUsTerritorialGovernorSeat(stateId: string, now: Date): Seat {
  const stateName = getStateName(stateId, "US");
  return {
    _id: buildSeatId("US", "governor", stateId),
    countryId: "US",
    electionType: "governor",
    state: stateId,
    displayName: `${stateName} Territorial Governor`,
    shortName: `${getLocalRegionId(stateId, "US")} Terr Gov`,
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedSeats(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
): Promise<void> {
  const col = db.collection<Seat>("seats");
  const now = new Date();
  // House seat counts per state depend on the preset's apportionment era.
  const houseSeatsByState = getHouseSeats(preset);
  // Commons likewise — 625 in 1953-default, else the modern 650 map (#1058).
  const ukCommonsSeatsByRegion = getUkCommonsSeats(preset);

  // States admitted mid-game are absent from that frozen map, so read their
  // live delegation size off the state docs. Without this a reset of a world
  // that admitted Alaska in 1959 would silently strip its seats back out.
  const admittedHouseSeats = new Map<string, number>();
  const usStateDocs = (await db
    .collection("states")
    .find({ countryId: "US" }, { projection: { _id: 1, houseDistricts: 1, admittedYear: 1 } })
    .toArray()) as unknown as Array<{
    _id: string;
    houseDistricts?: number;
    admittedYear?: number;
  }>;
  for (const s of usStateDocs) {
    if (typeof s.admittedYear === "number") {
      admittedHouseSeats.set(s._id, s.houseDistricts ?? 1);
    }
  }

  if (reset) {
    await col.deleteMany({});
    log("Dropped seats collection");
  }

  const seats: Seat[] = [];

  // US President
  seats.push({
    _id: buildSeatId("US", "president", "US"),
    countryId: "US",
    electionType: "president",
    state: "US",
    displayName: "U.S. President",
    shortName: "President",
    createdAt: now,
    updatedAt: now,
  });

  // US states
  for (const stateId of STATE_IDS) {
    // A US state absent from the active-era apportionment map is a pre-statehood
    // territory in this preset (Alaska/Hawaii under 1953-default). It elects a
    // territorial governor, but no House member, Senators, or State Senate.
    // Once admitted mid-game, a reset retains the full state seat set.
    const seatCount = houseSeatsByState[stateId] ?? admittedHouseSeats.get(stateId);
    if (seatCount != null) {
      seats.push(...buildUsStateSeats(stateId, seatCount, now));
    } else if (TERRITORY_ADMISSIONS.some((territory) => territory.stateId === stateId)) {
      seats.push(buildUsTerritorialGovernorSeat(stateId, now));
    }
  }

  // UK Commons
  for (const regionId of Object.keys(ukCommonsSeatsByRegion)) {
    seats.push({
      _id: buildSeatId("UK", "commons", regionId),
      countryId: "UK",
      electionType: "commons",
      state: regionId,
      totalSeats: ukCommonsSeatsByRegion[regionId],
      displayName: buildDisplayName("UK", "commons", regionId),
      shortName: buildShortName("UK", "commons", regionId),
      createdAt: now,
      updatedAt: now,
    });
  }

  // DE Bundestag
  for (const regionId of Object.keys(DE_WAHLKREIS_SEATS)) {
    seats.push({
      _id: buildSeatId("DE", "bundestag", regionId),
      countryId: "DE",
      electionType: "bundestag",
      state: regionId,
      totalSeats: DE_WAHLKREIS_SEATS[regionId],
      displayName: buildDisplayName("DE", "bundestag", regionId),
      shortName: buildShortName("DE", "bundestag", regionId),
      createdAt: now,
      updatedAt: now,
    });
  }

  // DE Landtag (one seat doc per Bundesland)
  const { deRegions } = await import("@/lib/seeds/de/deRegions");
  for (const region of deRegions) {
    seats.push({
      _id: buildSeatId("DE", "landtag", region._id),
      countryId: "DE",
      electionType: "landtag",
      state: region._id,
      totalSeats: region.stateSenateSeats ?? 1,
      displayName: buildDisplayName("DE", "landtag", region._id),
      shortName: buildShortName("DE", "landtag", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // JP Shugiin (House of Representatives)
  for (const regionId of Object.keys(JP_SHUGIIN_SEATS)) {
    seats.push({
      _id: buildSeatId("JP", "shugiin", regionId),
      countryId: "JP",
      electionType: "shugiin",
      state: regionId,
      totalSeats: JP_SHUGIIN_SEATS[regionId],
      displayName: buildDisplayName("JP", "shugiin", regionId),
      shortName: buildShortName("JP", "shugiin", regionId),
      createdAt: now,
      updatedAt: now,
    });
  }

  // JP Sangiin (House of Councillors) — half-elections every 3 game-years; each
  // region gets one Seat per class so Class 1 and Class 2 elections route to
  // distinct seatIds. Total regional seats split with Class 1 = ceil, Class 2 = floor.
  for (const regionId of Object.keys(JP_SANGIIN_SEATS)) {
    const totalSeats = JP_SANGIIN_SEATS[regionId];
    const seatsByClass: Record<1 | 2, number> = {
      1: Math.ceil(totalSeats / 2),
      2: Math.floor(totalSeats / 2),
    };
    for (const cls of [1, 2] as const) {
      seats.push({
        _id: buildSeatId("JP", "sangiin", regionId, cls),
        countryId: "JP",
        electionType: "sangiin",
        state: regionId,
        chamberClass: cls,
        totalSeats: seatsByClass[cls],
        displayName: buildDisplayName("JP", "sangiin", regionId, cls),
        shortName: buildShortName("JP", "sangiin", regionId, cls),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // JP Governors
  for (const regionId of Object.keys(JP_SHUGIIN_SEATS)) {
    seats.push({
      _id: buildSeatId("JP", "governor", regionId),
      countryId: "JP",
      electionType: "governor",
      state: regionId,
      totalSeats: 1,
      displayName: buildDisplayName("JP", "governor", regionId),
      shortName: buildShortName("JP", "governor", regionId),
      createdAt: now,
      updatedAt: now,
    });
  }

  // BR Chamber of Deputies
  for (const region of brRegions) {
    seats.push({
      _id: buildSeatId("BR", "chamber", region._id),
      countryId: "BR",
      electionType: "chamber",
      state: region._id,
      totalSeats: region.houseDistricts,
      displayName: buildDisplayName("BR", "chamber", region._id),
      shortName: buildShortName("BR", "chamber", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // BR Senate
  for (const region of brRegions) {
    seats.push({
      _id: buildSeatId("BR", "senate", region._id),
      countryId: "BR",
      electionType: "senate",
      state: region._id,
      totalSeats: region.stateSenateSeats,
      displayName: buildDisplayName("BR", "senate", region._id),
      shortName: buildShortName("BR", "senate", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // BR Governors
  for (const region of brRegions) {
    seats.push({
      _id: buildSeatId("BR", "governor", region._id),
      countryId: "BR",
      electionType: "governor",
      state: region._id,
      totalSeats: 1,
      displayName: buildDisplayName("BR", "governor", region._id),
      shortName: buildShortName("BR", "governor", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // NG Chamber of Deputies
  for (const region of ngRegions) {
    seats.push({
      _id: buildSeatId("NG", "chamber", region._id),
      countryId: "NG",
      electionType: "chamber",
      state: region._id,
      totalSeats: region.houseDistricts,
      displayName: buildDisplayName("NG", "chamber", region._id),
      shortName: buildShortName("NG", "chamber", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // NG Senate
  for (const region of ngRegions) {
    seats.push({
      _id: buildSeatId("NG", "senate", region._id),
      countryId: "NG",
      electionType: "senate",
      state: region._id,
      totalSeats: region.stateSenateSeats,
      displayName: buildDisplayName("NG", "senate", region._id),
      shortName: buildShortName("NG", "senate", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // NG Governors
  for (const region of ngRegions) {
    seats.push({
      _id: buildSeatId("NG", "governor", region._id),
      countryId: "NG",
      electionType: "governor",
      state: region._id,
      totalSeats: 1,
      displayName: buildDisplayName("NG", "governor", region._id),
      shortName: buildShortName("NG", "governor", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // NG President (directly elected, national)
  seats.push({
    _id: buildSeatId("NG", "president", "NG"),
    countryId: "NG",
    electionType: "president",
    state: "NG",
    totalSeats: 1,
    displayName: "President of Nigeria",
    shortName: "President",
    createdAt: now,
    updatedAt: now,
  });

  // CN NPC Delegates
  for (const region of cnRegions) {
    seats.push({
      _id: buildSeatId("CN", "npcDelegate", region._id),
      countryId: "CN",
      electionType: "npcDelegate",
      state: region._id,
      totalSeats: region.houseDistricts,
      displayName: buildDisplayName("CN", "npcDelegate", region._id),
      shortName: buildShortName("CN", "npcDelegate", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // CN Provincial People's Congress (sub-national legislatures)
  for (const region of cnRegions) {
    const ppcSeats = getCnPeoplesCongressSeats(preset)[region._id];
    if (ppcSeats === undefined) continue;
    seats.push({
      _id: buildSeatId("CN", "peoplesCongress", region._id),
      countryId: "CN",
      electionType: "peoplesCongress",
      state: region._id,
      totalSeats: ppcSeats,
      displayName: buildDisplayName("CN", "peoplesCongress", region._id),
      shortName: buildShortName("CN", "peoplesCongress", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // CN Governors (regional executives)
  for (const region of cnRegions) {
    seats.push({
      _id: buildSeatId("CN", "governor", region._id),
      countryId: "CN",
      electionType: "governor",
      state: region._id,
      totalSeats: 1,
      displayName: buildDisplayName("CN", "governor", region._id),
      shortName: buildShortName("CN", "governor", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // IE Dáil
  for (const region of ieRegions) {
    seats.push({
      _id: buildSeatId("IE", "dail", region._id),
      countryId: "IE",
      electionType: "dail",
      state: region._id,
      totalSeats: region.houseDistricts,
      displayName: buildDisplayName("IE", "dail", region._id),
      shortName: buildShortName("IE", "dail", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // IE Seanad
  for (const region of ieRegions) {
    seats.push({
      _id: buildSeatId("IE", "seanad", region._id),
      countryId: "IE",
      electionType: "seanad",
      state: region._id,
      totalSeats: region.stateSenateSeats,
      displayName: buildDisplayName("IE", "seanad", region._id),
      shortName: buildShortName("IE", "seanad", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // IE Uachtarán na hÉireann — single-seat nationwide (directly elected,
  // mirrors the US President seat-doc pattern). state = "IE" matches the
  // election-spawn convention so getSeatIdFromElection resolves correctly.
  seats.push({
    _id: buildSeatId("IE", "uachtaran", "IE"),
    countryId: "IE",
    electionType: "uachtaran",
    state: "IE",
    displayName: "Uachtarán na hÉireann",
    shortName: "Uachtarán",
    createdAt: now,
    updatedAt: now,
  });

  // IE Local Councils (multi-seat per region, PR-STV)
  for (const region of ieRegions) {
    seats.push({
      _id: buildSeatId("IE", "localCouncil", region._id),
      countryId: "IE",
      electionType: "localCouncil",
      state: region._id,
      totalSeats: IE_LOCAL_COUNCIL_SEATS_LOCAL[region._id] ?? 1,
      displayName: buildDisplayName("IE", "localCouncil", region._id),
      shortName: buildShortName("IE", "localCouncil", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // IE Cathaoirleach (single-seat per region, recycled "governor" electionType)
  for (const region of ieRegions) {
    seats.push({
      _id: buildSeatId("IE", "governor", region._id),
      countryId: "IE",
      electionType: "governor",
      state: region._id,
      totalSeats: 1,
      displayName: buildDisplayName("IE", "governor", region._id),
      shortName: buildShortName("IE", "governor", region._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Upsert all seats
  let upserted = 0;
  const bulkOps = seats.map((seat) => {
    const { _id, ...seatData } = seat;
    return { updateOne: { filter: { _id }, update: { $set: seatData }, upsert: true } };
  });
  const bulkResult = await col.bulkWrite(bulkOps, { ordered: false });
  upserted = bulkResult.upsertedCount;

  // Create indexes
  await col.createIndex({ countryId: 1, electionType: 1 });

  log(`Seeded ${seats.length} seats (${upserted} new, ${seats.length - upserted} updated)`);
}
