import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { seedFromSeats, type SeedMode } from "@/lib/npp/seedHistorical";
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import type { PoliticalParty, State, StatePartyOrg } from "@/lib/db/types";
import { buildProportionalChamberSeats } from "@/lib/seeds/proportionalChamberSeats";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

/**
 * Economy-tier ("ECON") democracies that are enabled for live economy + NPP
 * politics (their legislative election cycles spawn — see #3239) but whose
 * chambers `historicalSeats.ts` deliberately leaves unauthored: FR/IT/ES/SE/TR.
 *
 * Root cause (#3253): with no seeded NPPs/officials AND no statePartyOrg
 * presence rows, their election cycles resolve EMPTY — a multi-seat PR chamber
 * fields candidates through incumbent defense, so a chamber that starts with
 * zero incumbents has no one to defend and the primary window closes with no
 * candidate supply. The admin NPP generator also skips their office types
 * (`deputy`/`senator`/`member`), so nothing backfills the field at runtime.
 *
 * This seeder gives each of the five a minimal, principled starting roster:
 *   1. `statePartyOrg` presence rows for every (region × default party) so the
 *      region Party Organizations page renders and downstream presence gates
 *      (`canPartyFieldInState`) resolve — mirrors the US
 *      `generateStatePartyOrg` "major parties have presence in every state"
 *      convention (organization + hasPresence only; no fabricated
 *      registration/registrationShare, so general-election weighting stays
 *      byte-identical to pre-seed worlds).
 *   2. One seated incumbent NPP per (region × MAJOR party × chamber) via the
 *      canonical `seedFromSeats` pipeline — enough that both major parties hold
 *      a seat to defend in every region, so the next cycle has a contested
 *      field. Minor parties get presence (org rows) but no fabricated
 *      incumbents.
 *
 * Preset-agnostic: only default parties VALID for the active preset are seeded
 * (loaded from the DB after `ensureDefaultParties`). Today FR/IT/ES/SE/TR
 * default parties are authored for `1979-default` only, so this is a no-op for
 * presets without their parties — it self-extinguishes rather than fabricating
 * a roster with no parties behind it.
 */
export const ECON_TIER_ROSTER_COUNTRIES: readonly CountryId[] = [
  "FR",
  "IT",
  "ES",
  "TR",
  "SE",
  "GR",
  "AT",
  "FI",
] as const;

/** Baseline org for a seeded presence row; majors get a lean bonus. */
const BASELINE_ORG = 28;
const MAJOR_ORG = 45;

export interface EconTierRosterResult {
  countryId: CountryId;
  orgRows: number;
  nppsCreated: number;
  officialsCreated: number;
}

/** Minimal party projection consumed by the pure builders below. */
export interface RosterParty {
  sequentialId: number | string;
  name: string;
}

/**
 * Pure: one `statePartyOrg` presence row per (region × party). Majors (the
 * first `majorCount` parties by seed/sequential order) get an org bonus; the
 * rest get baseline. `hasPresence` is always true — these are the country's
 * national default parties, present everywhere by construction.
 */
export function buildEconTierStatePartyOrgRows(
  countryId: CountryId,
  regionIds: string[],
  parties: RosterParty[],
  majorCount = 2
): Omit<StatePartyOrg, "createdAt" | "updatedAt">[] {
  const rows: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  for (const stateId of regionIds) {
    parties.forEach((party, idx) => {
      const partyId = String(party.sequentialId);
      rows.push({
        _id: `${stateId}_${partyId}`,
        countryId,
        stateId,
        partyId,
        organization: idx < majorCount ? MAJOR_ORG : BASELINE_ORG,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 0,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      });
    });
  }
  return rows;
}

/**
 * Pure: full-chamber HistoricalSeat roster for one office type.
 *
 * Replaces the old uniform "1 token seat per (region × major party)" filler
 * that never checked Σ seats against `totalSeats` (audit: UK 806≠650,
 * IT 945≠630). Allocates seatsHeld proportionally to party weights so the
 * national total equals `targetSeats` exactly (largest-remainder).
 *
 * `party` carries the party NAME — `seedFromSeats` resolves it to a
 * sequentialId via its name-substring fallback, exactly as
 * `backfillMissingSeats` does.
 */
export function buildEconTierChamberSeats(
  officeType: string,
  regions: { id: string; seats: number }[],
  parties: { name: string; weight: number }[],
  targetSeats: number
): HistoricalSeat[] {
  return buildProportionalChamberSeats({
    officeType,
    regions,
    parties,
    targetSeats,
  });
}

/**
 * Seed statePartyOrg presence + a minimal incumbent roster for ONE econ-tier
 * country. No-op (returns zeroes) when the country has no default parties for
 * the active preset or no seeded regions.
 *
 * `seedMode === "priors"` (pre-iteration founding reset) seeds ONLY presence
 * rows and leaves chambers vacant for the founding elections to fill — same
 * contract as `seedFromSeats("priors")`.
 *
 * `opts.seedOrgRows` (default `true`) gates step 1 (the blanket
 * every-region-× -every-party `statePartyOrg` presence rows). Callers for a
 * country that already has a bespoke, regionally-calibrated org calculator
 * (e.g. UK's `calculateUKStatePartyOrgs`) MUST pass `false` here — this
 * step's flat `MAJOR_ORG`/`BASELINE_ORG` values and always-`hasPresence:true`
 * rows are a blunt fallback for countries with NO org data at all (the five
 * econ-tier democracies), and upserting them on top of real per-region data
 * silently overwrites it back to a uniform grid and re-adds `hasPresence`
 * rows for regionally-confined parties outside their home region — exactly
 * the #3895 bug (SNP/Plaid/Sinn Féin fielding nationwide because the UK call
 * below used to run this step unconditionally after `seedUKStatePartyOrg`
 * had already done the real calibration). Step 2 (incumbent seats) is
 * unaffected — that's the actual reason UK reuses this seeder at all.
 */
export async function seedEconTierRostersForCountry(
  db: Db,
  countryId: CountryId,
  seedMode: SeedMode = "winners",
  log: (msg: string) => void = () => {},
  opts: { seedOrgRows?: boolean } = {}
): Promise<EconTierRosterResult> {
  const seedOrgRows = opts.seedOrgRows ?? true;
  const empty: EconTierRosterResult = {
    countryId,
    orgRows: 0,
    nppsCreated: 0,
    officialsCreated: 0,
  };
  const preset = await getGameStatePreset(db);
  const config = getCountryConfig(countryId, preset);
  if (!config?.legislature) return empty;

  // Default parties actually seeded for this preset, in ascending sequentialId
  // (≈ seed order, so the first two are the majors — same convention as
  // challengerSupply's top-2 default parties).
  const parties = (await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, isDefault: true }, { projection: { sequentialId: 1, name: 1 } })
    .sort({ sequentialId: 1 })
    .toArray()) as unknown as RosterParty[];
  if (parties.length === 0) return empty;

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, houseDistricts: 1, stateSenateSeats: 1 } })
    .toArray();
  if (regions.length === 0) return empty;
  const regionIds = regions.map((s) => String(s._id));

  // 1. statePartyOrg presence rows (upsert — idempotent across resets).
  // Skipped entirely when the country already has bespoke regional org data
  // (see `opts.seedOrgRows` doc above) — this step would otherwise clobber
  // it with a flat, nationwide-presence placeholder grid.
  const now = new Date();
  const orgRows = seedOrgRows ? buildEconTierStatePartyOrgRows(countryId, regionIds, parties) : [];
  if (orgRows.length > 0) {
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(
      orgRows.map((row) => {
        const { _id, ...rest } = row;
        return {
          updateOne: {
            filter: { _id },
            update: { $set: { ...rest, updatedAt: now }, $setOnInsert: { createdAt: now } },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
  }

  // 2. Incumbent roster — only in "winners" mode (priors leaves chambers vacant
  // for the founding election). All default parties get a proportional share
  // of the chamber (majors weighted higher via MAJOR_ORG) so Σ seatsHeld equals
  // configured totalSeats. Appointed / non-elected upper chambers are skipped
  // (same gate as backfillMissingSeats) — inventing Lords/Första incumbents
  // inflated UK/SE party seat sums past lower-chamber totalSeats in the audit.
  let nppsCreated = 0;
  let officialsCreated = 0;
  if (seedMode === "winners") {
    const partyWeights = parties.map((p, idx) => ({
      name: p.name,
      weight: idx < 2 ? MAJOR_ORG : BASELINE_ORG,
    }));
    const lowerRegions = regions.map((r) => ({
      id: String(r._id),
      seats: r.houseDistricts ?? 0,
    }));
    const seats: HistoricalSeat[] = [];
    const lowerTarget = config.legislature.lowerChamber?.seats ?? 0;
    if (lowerTarget > 0) {
      seats.push(
        ...buildEconTierChamberSeats(
          getLowerChamberOfficeType(countryId, preset),
          lowerRegions,
          partyWeights,
          lowerTarget
        )
      );
    }
    if (
      config.legislature.bicameral &&
      config.legislature.upperChamber &&
      config.upperElectionSystem
    ) {
      const upper = getUpperChamberOfficeType(countryId, preset);
      const upperTarget = config.legislature.upperChamber.seats ?? 0;
      if (upper && upperTarget > 0) {
        const upperRegions = regions.map((r) => ({
          id: String(r._id),
          seats: r.stateSenateSeats ?? 0,
        }));
        seats.push(...buildEconTierChamberSeats(upper, upperRegions, partyWeights, upperTarget));
      }
    }
    if (seats.length > 0) {
      // Idempotent: a chamber that already holds seated NPPs was seeded by a
      // previous pass, so skip it rather than appending a second full roster.
      // Without this, re-running a reset that died partway (a realistic operator
      // action — it is what happened) exactly DOUBLED every already-seeded
      // country's legislature, silently: FR 80→160, IT 80→160, UK 72→144,
      // SE 40→80, TR 16→32, ES 8→16, AT 20→40, FI 24→48, GR 18→36.
      const result = await seedFromSeats(db, seats, "winners", {
        skipAlreadySeatedChambers: true,
      });
      nppsCreated = result.nppsCreated;
      officialsCreated = result.officialsCreated;
    }
  }

  log(
    `[econTierRosters] ${countryId}: ${orgRows.length} org rows, ${nppsCreated} NPPs, ${officialsCreated} officials (${seedMode})`
  );
  return { countryId, orgRows: orgRows.length, nppsCreated, officialsCreated };
}

/**
 * Seed econ-tier rosters for every {@link ECON_TIER_ROSTER_COUNTRIES}. Safe to
 * run on every reset/bootstrap AND safe to re-run after a partial failure:
 * presence rows upsert, and incumbent seats are skipped for any chamber that
 * already holds seated NPPs (`skipAlreadySeatedChambers`).
 *
 * This docstring previously claimed incumbents were "only added when the chamber
 * office type has no incumbents behind it" — that contract was documented but
 * never implemented. `seedFromSeats` was called unconditionally with a full
 * chamber roster, so a re-run appended a second parallel legislature. The claim
 * is now true.
 */
export async function seedEconTierRosters(
  db: Db,
  seedMode: SeedMode = "winners",
  log: (msg: string) => void = () => {}
): Promise<{ nppsCreated: number; officialsCreated: number; orgRows: number }> {
  let nppsCreated = 0;
  let officialsCreated = 0;
  let orgRows = 0;
  for (const countryId of ECON_TIER_ROSTER_COUNTRIES) {
    const r = await seedEconTierRostersForCountry(db, countryId, seedMode, log);
    nppsCreated += r.nppsCreated;
    officialsCreated += r.officialsCreated;
    orgRows += r.orgRows;
  }
  return { nppsCreated, officialsCreated, orgRows };
}
