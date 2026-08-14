import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CountryId } from "@/lib/constants/countries";
import { commandEconomySoeSectors, isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";

export interface CommandEconomyCountryReport {
  countryId: CountryId;
  expectedSoeSectors: number;
  actualSoes: number;
  /** SOE sector types the country should have an enterprise for and does not. */
  missingSoeSectors: string[];
  /**
   * Producing sectors hanging off the country's PRIMARY national corporation
   * rather than an SOE. Non-zero means the sovereign issuer is doubling as the
   * whole economy, which is the pre-Command-Economy-v2 shape.
   */
  sectorsOnPrimaryCorp: number;
  /** True when the country has no producing sectors owned by anyone. */
  noProducingSectors: boolean;
}

export interface CommandEconomySeedReport {
  /** False when the flag is off, in which case nothing here is checked. */
  checked: boolean;
  countries: CommandEconomyCountryReport[];
  /** Human-readable one-liners, empty when the seed is sound. */
  issues: string[];
  /** Countries with zero SOEs or zero producing sectors: an unplayable economy. */
  fatal: CountryId[];
}

/**
 * Post-seed assertion for command economies (ticket #1014 follow-up).
 *
 * The seeders that split a command country into one SOE per commanding-height sector
 * (`seedRuBudgets`, `seedCnBudgets`, `seedDdBudgets`, the Warsaw-Pact block) all read
 * `gameConfig.commandEconomyEnabled` themselves and, when it is off or their entry is
 * missing, quietly fall back to the legacy "sovereign issuer owns everything" shape.
 * Every one of those fallbacks is a silent `return` or an empty filter result, so a
 * bootstrap can complete cleanly and still hand a country full of players an economy
 * with nothing in it.
 *
 * That is not hypothetical. On the live iteration-4 world the USSR came up with zero
 * SOEs AND zero producing sectors of any kind, and it stayed that way for 73 turns
 * before a deploy-time pass finally attached all 238 sectors to the bare sovereign
 * issuer. Forty-four players had no enterprise to run and nowhere to found one, and
 * nothing in the seed log said so. Meanwhile every other command country in the same
 * world (DD, PL, HU, CS, BG, RO, YU, CN) seeded correctly, so there was no global
 * symptom to notice either.
 *
 * This is the check that would have caught it: read back what the seed actually
 * produced and compare it to `commandEconomySoeSectors`. Read-only.
 */
export async function verifyCommandEconomySeed(
  db: Db,
  preset: string
): Promise<CommandEconomySeedReport> {
  const empty: CommandEconomySeedReport = { checked: false, countries: [], issues: [], fatal: [] };

  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  if (gameConfig?.commandEconomyEnabled !== true) return empty;

  const startingYear = getStartingYearForPreset(preset);

  // Only countries that actually have regions in this world: a preset that never
  // seeds Yugoslavia must not be reported as missing Yugoslavia's enterprises.
  const seededCountryIds = [
    ...new Set(
      (
        await db
          .collection<State>("states")
          .find({}, { projection: { countryId: 1 } })
          .toArray()
      ).map((s) => s.countryId as CountryId)
    ),
  ];

  const countries: CommandEconomyCountryReport[] = [];
  const issues: string[] = [];
  const fatal: CountryId[] = [];

  for (const countryId of seededCountryIds) {
    const expected = commandEconomySoeSectors(countryId);
    if (expected.length === 0) continue;
    if (!isCommandEconomy(countryId, startingYear, true)) continue;

    const [soes, sectors, primaryCorp] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({ countryId, soe: { $exists: true } }, { projection: { soe: 1 } })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ countryId }, { projection: { corporationId: 1 } })
        .toArray(),
      db
        .collection<Corporation>("corporations")
        .findOne({ countryId, isPrimaryNationalCorporation: true }, { projection: { _id: 1 } }),
    ]);

    const haveSectors = new Set(
      soes
        .map((c) => (c as Corporation & { soe?: { sector?: string } }).soe?.sector)
        .filter(Boolean)
    );
    const missingSoeSectors = expected.filter((s) => !haveSectors.has(s));
    const sectorsOnPrimaryCorp = primaryCorp
      ? sectors.filter((s) => String(s.corporationId) === String(primaryCorp._id)).length
      : 0;
    const noProducingSectors = sectors.length === 0;

    const report: CommandEconomyCountryReport = {
      countryId,
      expectedSoeSectors: expected.length,
      actualSoes: soes.length,
      missingSoeSectors,
      sectorsOnPrimaryCorp,
      noProducingSectors,
    };
    countries.push(report);

    if (noProducingSectors) {
      issues.push(
        `[${countryId}] command economy has ZERO producing sectors — the country produces nothing and no player can found anything.`
      );
      fatal.push(countryId);
    }
    if (soes.length === 0) {
      issues.push(
        `[${countryId}] command economy has ZERO state enterprises (expected ${expected.length}) — the command-economy dashboard renders an empty table and no seat is claimable.`
      );
      if (!fatal.includes(countryId)) fatal.push(countryId);
    } else if (missingSoeSectors.length > 0) {
      issues.push(
        `[${countryId}] missing ${missingSoeSectors.length} of ${expected.length} state enterprises: ${missingSoeSectors.join(", ")}`
      );
    }
    if (sectorsOnPrimaryCorp > 0) {
      issues.push(
        `[${countryId}] ${sectorsOnPrimaryCorp} producing sector(s) hang off the sovereign issuer instead of an SOE — this is the legacy single-corp shape, not the v2 split.`
      );
    }
  }

  return { checked: true, countries, issues, fatal };
}
