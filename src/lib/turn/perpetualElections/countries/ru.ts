import { getDb } from "@/lib/mongodb";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import {
  ensureRegionalDelegateElections,
  ensureRegionalGovernorElections,
  ruElectionsLive,
  seatsFromRegionField,
} from "../shared";

/** Soviet of the Union — seats per region = the live region doc's houseDistricts. */
export async function ensureRUSupremeSovietElections(now: Date): Promise<void> {
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
    now
  );
}

/** Soviet of Nationalities — republic-weighted D11 map, same-day as the Union. */
export async function ensureRUNationalitiesElections(now: Date): Promise<void> {
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
    now
  );
}

/**
 * Republic Supreme Soviets — each region's own authored chamber size
 * (`stateSenateSeats` on the seeded State doc, the realistic per-republic
 * Supreme Soviet sizes from the map seed). Reading the live doc keeps the
 * election totals, the admin seat panel, and state-bill passage thresholds
 * on one source of truth (amended D11 — user decision 2026-07-20).
 */
export async function ensureRURepublicSovietElections(now: Date): Promise<void> {
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
    now
  );
}

/**
 * Republic First Secretaries — the shared governor family with the D10 anchor
 * override (ruRepublicSoviet, threaded via countryId). The shared helper has
 * no status gate, so the RU wrapper adds it (the NG pattern).
 */
export async function ensureRUGovernorElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ruElectionsLive(db))) return;
  await ensureRegionalGovernorElections("RU", now);
}

// ─── East Germany: Volkskammer ──────────────────────────────────────────────
