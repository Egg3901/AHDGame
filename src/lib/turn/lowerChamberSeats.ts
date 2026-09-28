/**
 * Live lower-chamber size = the sum of the country's region `houseDistricts`.
 *
 * The static `config.legislature.lowerChamber.seats` is the *starting* size; the
 * election engine already sizes constituencies from region `houseDistricts`, so
 * the live total is the SSOT once a region is added or removed at runtime (a
 * region transfer — e.g. NI joining Ireland grows the Dáil). Parliamentary
 * majority math reads the live total so the threshold tracks the real chamber.
 *
 * Reported as `max(config base, region sum)`: the chamber never under-reports its
 * config base (so a region's seat-data discrepancy can't shrink an untransferred
 * chamber — e.g. UK regions summing to 648 still report the 650-seat Commons), and
 * grows above the base when a region is added (NI joining → 160 + 71). Bulgaria's
 * dated 1991 chamber replacement explicitly lowers this floor to 240 after the
 * ordinary Assembly opens. For other untransferred parliamentary configs the
 * result equals `configSeats`, so
 * `coalitionThreshold === floor(configSeats / 2) + 1` still holds.
 */
import type { Db } from "mongodb";
import type { CountryGameState, State } from "@/lib/db/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { isListTierMethod } from "@/lib/elections/electionMethod";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { BG_ORDINARY_ASSEMBLY_TOTAL_SEATS } from "@/lib/countries/bg/rules/assemblyTransition";

/** Active world preset, when present — drives era-conditional chamber sizes. */
async function readActivePreset(db: Db): Promise<string | undefined> {
  return getGameStatePreset(db);
}

/**
 * Mixed electoral systems carry a separate party-list tier that is NOT captured
 * in region `houseDistricts` (DE AMS: ~299 constituencies vs 630 total). For
 * these, the live region sum understates the chamber, so the config size is the
 * SSOT. Single-tier systems (FPTP, PR-STV) seat the whole chamber by region, so
 * their region sum is authoritative — and grows/shrinks when a region transfers.
 */
export async function getLiveLowerChamberSeats(db: Db, countryId: CountryId): Promise<number> {
  const preset = await readActivePreset(db);
  const config = getCountryConfig(countryId, preset);
  // Hungary's 1991-world config is deliberately frozen at its 386-seat start.
  // Once the 2014 reform stamps the world, the re-apportioned region documents
  // carry the live 199-seat chamber and override that initial config size.
  if (countryId === "HU") {
    const reform = await db
      .collection<{ _id: string; huAssemblyReformedAtYear?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { huAssemblyReformedAtYear: 1 } });
    if (reform?.huAssemblyReformedAtYear) {
      const regions = await db
        .collection<State>("states")
        .find({ countryId }, { projection: { houseDistricts: 1 } })
        .toArray();
      const seats = regions.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0);
      if (seats > 0) return seats;
    }
  }
  if (countryId === "BG" && preset === "1991-default") {
    const countryState = await db
      .collection<CountryGameState>("countryGameStates")
      .findOne({ _id: "BG" }, { projection: { bgOrdinaryAssemblySinceTurn: 1 } });
    if (countryState?.bgOrdinaryAssemblySinceTurn != null) {
      return BG_ORDINARY_ASSEMBLY_TOTAL_SEATS;
    }
  }
  if (isListTierMethod(config.electionSystems.lowerChamber)) {
    return config.legislature.lowerChamber.seats;
  }
  const regions = await db
    .collection<State>("states")
    .find({ countryId })
    .project<{ houseDistricts?: number }>({ houseDistricts: 1 })
    .toArray();
  const sum = regions.reduce((acc, r) => acc + (r.houseDistricts ?? 0), 0);
  return Math.max(sum, config.legislature.lowerChamber.seats);
}

/** Simple-majority threshold for a chamber of `totalSeats`. */
export function lowerChamberMajorityThreshold(totalSeats: number): number {
  return Math.floor(totalSeats / 2) + 1;
}

/**
 * Countries whose UPPER chamber is apportioned across regions via
 * `state.stateSenateSeats` (so it grows/shrinks with a region transfer — IE's
 * Seanad is split across the NUTS-III regions, summing to its 60 seats; SE's
 * 1953 First Chamber uses the same field across län groups). For everyone else
 * `stateSenateSeats` is a DIFFERENT chamber (UK's is the regional council, not
 * the Lords; SE 1979+ is nominal county-council weight, not the abolished
 * First Chamber), so the upper size stays the static config.
 *
 * SE is listed here but only applied under the 1953-default preset — see
 * {@link getLiveUpperChamberSeats}.
 */
const UPPER_CHAMBER_REGION_APPORTIONED: ReadonlySet<CountryId> = new Set<CountryId>(["IE", "SE"]);

function isUpperChamberRegionApportioned(countryId: CountryId, preset?: string): boolean {
  if (!UPPER_CHAMBER_REGION_APPORTIONED.has(countryId)) return false;
  // SE: only the bicameral-era First Chamber is region-apportioned. 1979+
  // regions still carry stateSenateSeats as county-council weight; summing
  // those must not inflate the abolished upperChamber metadata (151 seats).
  if (countryId === "SE") return preset === "1953-default";
  return true;
}

/**
 * Live upper-chamber size. For a region-apportioned upper chamber it's the live
 * `max(config base, Σ region stateSenateSeats)` (NI joining grows the Seanad
 * 60 → 84); otherwise the static config size.
 */
export async function getLiveUpperChamberSeats(db: Db, countryId: CountryId): Promise<number> {
  const preset = await readActivePreset(db);
  const config = getCountryConfig(countryId, preset);
  const upper = config.legislature.upperChamber;
  if (!upper) return 0;
  if (!isUpperChamberRegionApportioned(countryId, preset)) return upper.seats;
  const regions = await db
    .collection<State>("states")
    .find({ countryId })
    .project<{ stateSenateSeats?: number }>({ stateSenateSeats: 1 })
    .toArray();
  const sum = regions.reduce((acc, r) => acc + (r.stateSenateSeats ?? 0), 0);
  return Math.max(sum, upper.seats);
}
