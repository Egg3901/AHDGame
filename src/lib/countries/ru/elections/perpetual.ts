import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import {
  ensureRegionalDelegateElections,
  ensureRegionalGovernorElections,
  ruElectionsLive,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";

/** Soviet of the Union — seats per region = the live region doc's houseDistricts. */
export async function ensureRUSupremeSovietElections(
  now: Date,
  inFlightTurn?: number
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "supremeSovietDeputy",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Supreme Soviet",
    },
    now,
    inFlightTurn
  );
}

/** Election type (and seated office) of the 1991 Soviet Congress of People's Deputies. */
export const RU_UNION_CONGRESS_ELECTION_TYPE = "unionCongressDeputy";

/**
 * The Union Congress elects only while it is RU's active lower chamber: after
 * the Soviet succession the runtime office becomes the Russian Congress (and
 * later the Duma), and those chambers have their own seating paths.
 */
export async function ruUnionCongressLive(db: Db): Promise<boolean> {
  if (!(await ruElectionsLive(db))) return false;
  // Lazy, so this client-reachable leaf keeps its existing static import set.
  const { loadRuntimeCountryOffices } = await import("@/lib/countries/runtimeOffices");
  const { lowerOfficeType } = await loadRuntimeCountryOffices(db, "RU");
  return lowerOfficeType === RU_UNION_CONGRESS_ELECTION_TYPE;
}

/**
 * Soviet Congress of People's Deputies (1991 start). Seats per region = the
 * live region doc's houseDistricts, which sum to the 2,250-seat chamber. The
 * `ruUnionCongress` anchor is null outside the 1991 preset, so this spawns
 * nothing in the Cold War or modern eras.
 */
export async function ensureRUUnionCongressElections(
  now: Date,
  inFlightTurn?: number
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: RU_UNION_CONGRESS_ELECTION_TYPE,
      seatsForRegions: (regions) => seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruUnionCongressLive,
      label: "Union Congress",
    },
    now,
    inFlightTurn
  );
}

/** Soviet of Nationalities — republic-weighted D11 map, same-day as the Union. */
export async function ensureRUNationalitiesElections(
  now: Date,
  inFlightTurn?: number
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "nationalitiesDeputy",
      seatsForRegions: () => RU_NATIONALITIES_SEATS,
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Nationalities",
    },
    now,
    inFlightTurn
  );
}

/**
 * Republic Supreme Soviets — each region's own authored chamber size
 * (`stateSenateSeats` on the seeded State doc, the realistic per-republic
 * Supreme Soviet sizes from the map seed). Reading the live doc keeps the
 * election totals, the admin seat panel, and state-bill passage thresholds
 * on one source of truth (amended D11 — user decision 2026-07-20).
 */
export async function ensureRURepublicSovietElections(
  now: Date,
  inFlightTurn?: number
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "republicSupremeSoviet",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "stateSenateSeats"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Republic Soviet",
    },
    now,
    inFlightTurn
  );
}

/**
 * Republic First Secretaries — the shared governor family with the D10 anchor
 * override (ruRepublicSoviet, threaded via countryId). The shared helper has
 * no status gate, so the RU wrapper adds it (the NG pattern).
 */
export async function ensureRUGovernorElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  if (!(await ruElectionsLive(db))) return;
  await ensureRegionalGovernorElections("RU", now, undefined, inFlightTurn);
}

// ─── East Germany: Volkskammer ──────────────────────────────────────────────
