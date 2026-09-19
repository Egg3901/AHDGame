import { ObjectId, type Db } from "mongodb";
import type { Corporation, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { NPP_CAPITAL_STATES, spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import { getCharterCapitalRequirement, issueCharter } from "@/lib/banking/charter";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getRateCorridors } from "@/lib/banking/regulationQ";
import { setBankRates } from "@/lib/banking/rates";
import { getLegalCharterTypes } from "@/lib/banking/separationLaw";
import { loadWorldEraUnitScale, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { loadPrivateEnterpriseBlockedCountries } from "@/lib/economy/queries/privateEnterpriseGate";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { NG_IDENTITY } from "@/lib/countries/ng/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { FR_IDENTITY } from "@/lib/countries/fr/identity";
import { IT_IDENTITY } from "@/lib/countries/it/identity";
import { ES_IDENTITY } from "@/lib/countries/es/identity";
import { SE_IDENTITY } from "@/lib/countries/se/identity";
import { TR_IDENTITY } from "@/lib/countries/tr/identity";
import { GR_IDENTITY } from "@/lib/countries/gr/identity";
import { AT_IDENTITY } from "@/lib/countries/at/identity";
import { FI_IDENTITY } from "@/lib/countries/fi/identity";

/** Provisional: how many NPP retail banks each eligible country seeds. */
export const NPC_BANKS_PER_COUNTRY = 2;

/**
 * Working treasury multiplier over the charter capital requirement.
 * Posts 1x into the charter; the residual (2x) is the working buffer.
 */
export const NPC_BANK_CAPITAL_BUFFER_MULTIPLIER = 3;

const OFFSET_DRIFT_EPSILON = 1e-9;

/** Corporation docs may carry this seed idempotency key (not on the typed model). */
type NpcBankCorporation = Corporation & { npcBankSeedKey?: string };

export type SeedNpcBanksResult = {
  created: number;
  skippedExisting: number;
  skippedIneligible: number;
  charterFailures: number;
  /** Slots skipped because the configured HQ state is absent in this preset. */
  skippedNoState: number;
  /**
   * Countries deliberately excluded for this preset: the configured HQ state
   * does not exist (or belongs to another country), so no bank was attempted.
   * Machine-readable so bootstrap diagnostics can tell "excluded by design"
   * from "attempted and failed".
   */
  excludedMissingState: NpcBankHqExclusion[];
};

/**
 * Machine-readable reason a country was excluded from NPC-bank seeding for a
 * preset instead of being attempted.
 */
export type NpcBankHqExclusionReason = "no-state-in-preset" | "state-country-mismatch";

export interface NpcBankHqExclusion {
  countryId: CountryId;
  hqState: string;
  preset: string;
  reason: NpcBankHqExclusionReason;
}

export type NpcBankPolicySummary = {
  banksChecked: number;
  banksUpdated: number;
};

const ZERO_POLICY: NpcBankPolicySummary = { banksChecked: 0, banksUpdated: 0 };

/** Deterministic seed key for one NPC bank slot in a country. */
export function npcBankSeedKey(countryId: CountryId, index: number): string {
  return `npc-bank:${countryId}:${index}`;
}

/**
 * Era-appropriate generic bank names. No real institutions or people.
 * Country flavor is generic phrasing only (First / Commercial / Provincial).
 */
export function generateNpcBankName(
  countryId: CountryId,
  index: number,
  historicalEra: boolean
): string {
  const templates = historicalEra
    ? (COUNTRY_HISTORICAL_NAMES[countryId] ?? DEFAULT_HISTORICAL_NAMES)
    : (COUNTRY_MODERN_NAMES[countryId] ?? DEFAULT_MODERN_NAMES);
  return templates[index % templates.length]!;
}

const DEFAULT_HISTORICAL_NAMES = ["Meridian Commercial Bank", "Harbourline Savings Bank"] as const;
const DEFAULT_MODERN_NAMES = ["Meridian Banking Group", "Harbourline Financial"] as const;

/**
 * Per-country display flavor. Patterns only; never real bank brands.
 * Absent countries fall back to the defaults above.
 */
export const COUNTRY_HISTORICAL_NAMES: Partial<Record<CountryId, readonly string[]>> = {
  US: US_IDENTITY.historicalNames,
  UK: UK_IDENTITY.historicalNames,
  JP: JP_IDENTITY.historicalNames,
  DE: DE_IDENTITY.historicalNames,
  FR: FR_IDENTITY.historicalNames,
  IT: IT_IDENTITY.historicalNames,
  ES: ES_IDENTITY.historicalNames,
  IE: IE_IDENTITY.historicalNames,
  BR: BR_IDENTITY.historicalNames,
  NG: NG_IDENTITY.historicalNames,
  SE: SE_IDENTITY.historicalNames,
  TR: TR_IDENTITY.historicalNames,
  GR: GR_IDENTITY.historicalNames,
  AT: AT_IDENTITY.historicalNames,
  FI: FI_IDENTITY.historicalNames,
};

export const COUNTRY_MODERN_NAMES: Partial<Record<CountryId, readonly string[]>> = {
  US: US_IDENTITY.modernNames,
  UK: UK_IDENTITY.modernNames,
  JP: JP_IDENTITY.modernNames,
  DE: DE_IDENTITY.modernNames,
  FR: FR_IDENTITY.modernNames,
  IT: IT_IDENTITY.modernNames,
  ES: ES_IDENTITY.modernNames,
  IE: IE_IDENTITY.modernNames,
  BR: BR_IDENTITY.modernNames,
  NG: NG_IDENTITY.modernNames,
  SE: SE_IDENTITY.modernNames,
  TR: TR_IDENTITY.modernNames,
  GR: GR_IDENTITY.modernNames,
  AT: AT_IDENTITY.modernNames,
  FI: FI_IDENTITY.modernNames,
};

function corridorMidpoint(minOffset: number, maxOffset: number): number {
  return (minOffset + maxOffset) / 2;
}

/**
 * Lower-quartile deposit target for NPC banks. Incumbents price deposits
 * lazily: a player bank that merely matches the old midpoint still wins
 * share, which leaves room for a lending margin instead of forcing every
 * bank to overpay for the same base. Lending stays at the midpoint so NPC
 * loan-book economics do not move with this.
 */
export function corridorDepositTarget(minOffset: number, maxOffset: number): number {
  return minOffset + 0.25 * (maxOffset - minOffset);
}

function offsetsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= OFFSET_DRIFT_EPSILON;
}

/**
 * Seed NPP-run retail banks for every non-command country that can host a
 * financial NPP corp (capital HQ configured). Idempotent via `npcBankSeedKey`.
 *
 * The HQ state is verified against the world's seeded `states` before anything
 * is attempted: presets that do not model a country with regions (e.g. the
 * 1991/2019 presets seed no BLR/UKR/BAL states) exclude that country with a
 * machine-readable {@link NpcBankHqExclusion} instead of attempting and
 * logging failed bank creation for a deterministic missing reference.
 *
 * Seeding is not gated on `privateBankingEnabled`: charters are written through
 * the real {@link issueCharter} path with the seed-time skipFlagCheck bypass
 * (gameConfig is never mutated). Runtime policy/turn behavior still requires
 * the flag.
 *
 * Throws when an expected bank (HQ verified, country eligible) cannot be
 * seeded, so the bootstrap `guarded("seedNpcBanks", …)` step records it in the
 * run's failure list instead of silently shipping a bankless country.
 */
export async function seedNpcBanks(
  db: Db,
  log: (msg: string) => void = () => {}
): Promise<SeedNpcBanksResult> {
  const result: SeedNpcBanksResult = {
    created: 0,
    skippedExisting: 0,
    skippedIneligible: 0,
    charterFailures: 0,
    skippedNoState: 0,
    excludedMissingState: [],
  };

  const eraUnitScale = await loadWorldEraUnitScale(db);
  const historicalEra = eraUnitScale > 1;
  const preset = await loadWorldPreset(db);

  // Eligibility before attempts: a planned economy has no private banks to
  // seed. `getLegalCharterTypes` below already returns [] there when the
  // command-economy flag is on, but the creation gate deliberately ignores
  // that flag (a flag flip must not mint private enterprise inside the USSR),
  // so without this check a flag-off world attempts two doomed spawns per
  // planned country and records them as charter failures. Resolved ONCE for
  // the whole sweep against the same marketization-dial gate the spawn path
  // enforces.
  const blocked = await loadPrivateEnterpriseBlockedCountries(db);

  for (const countryId of ALL_COUNTRY_IDS) {
    const hqState = NPP_CAPITAL_STATES[countryId];
    if (!hqState) {
      result.skippedIneligible += NPC_BANKS_PER_COUNTRY;
      continue;
    }

    const currency = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode | undefined;
    if (!currency) {
      result.skippedIneligible += NPC_BANKS_PER_COUNTRY;
      continue;
    }

    // Preset check before any creation attempt: the configured HQ must exist
    // in this preset's seeded states and belong to this country. A missing HQ
    // is a deliberate exclusion (recorded with reason), never an attempted
    // spawn that fails with `State "…" not found`.
    const hqDoc = await db
      .collection<State>("states")
      .findOne({ _id: hqState }, { projection: { countryId: 1 } });
    if (!hqDoc || hqDoc.countryId !== countryId) {
      const reason: NpcBankHqExclusionReason = !hqDoc
        ? "no-state-in-preset"
        : "state-country-mismatch";
      result.excludedMissingState.push({ countryId, hqState, preset, reason });
      result.skippedNoState += NPC_BANKS_PER_COUNTRY;
      result.skippedIneligible += NPC_BANKS_PER_COUNTRY;
      log(
        `[seedNpcBanks] ${countryId} excluded for preset ${preset}: HQ state "${hqState}" ${reason}`
      );
      continue;
    }

    // Keep the preset graph check above the economic-policy gate. A country
    // can be ineligible for private enterprise and still carry a broken HQ
    // reference that bootstrap health must report machine-readably.
    if (blocked.has(countryId)) {
      result.skippedIneligible += NPC_BANKS_PER_COUNTRY;
      continue;
    }

    const legalTypes = await getLegalCharterTypes(db, countryId);
    if (legalTypes.length === 0 || !legalTypes.includes("retail")) {
      result.skippedIneligible += NPC_BANKS_PER_COUNTRY;
      continue;
    }

    const requirement = await getCharterCapitalRequirement(db, currency);
    const startingCapital = requirement * NPC_BANK_CAPITAL_BUFFER_MULTIPLIER;

    for (let index = 0; index < NPC_BANKS_PER_COUNTRY; index++) {
      const key = npcBankSeedKey(countryId, index);
      const existing = await db
        .collection<NpcBankCorporation>("corporations")
        .findOne({ npcBankSeedKey: key }, { projection: { _id: 1 } });
      if (existing) {
        result.skippedExisting += 1;
        continue;
      }

      const name = generateNpcBankName(countryId, index, historicalEra);

      // Name+country fallback if a prior run wrote the corp without the key.
      const byName = await db
        .collection<Corporation>("corporations")
        .findOne(
          { name, countryId, ceoType: "npp", type: "financial" },
          { projection: { _id: 1, bankCharter: 1 } }
        );
      if (byName) {
        await db
          .collection("corporations")
          .updateOne({ _id: byName._id }, { $set: { npcBankSeedKey: key, updatedAt: new Date() } });
        if (byName.bankCharter?.status !== "active") {
          const issued = await issueCharterWithFlag(db, byName._id, currency);
          if (!issued) result.charterFailures += 1;
        }
        result.skippedExisting += 1;
        continue;
      }

      try {
        const spawned = await spawnNppCorporation(db, {
          name,
          type: "financial",
          countryId,
          headquartersState: hqState,
          startingCapital,
        });
        const corpId = new ObjectId(spawned.corporationId);
        await db
          .collection("corporations")
          .updateOne({ _id: corpId }, { $set: { npcBankSeedKey: key, updatedAt: new Date() } });

        const issued = await issueCharterWithFlag(db, corpId, currency);
        if (!issued) {
          result.charterFailures += 1;
          log(`[seedNpcBanks] ${countryId} slot ${index}: corp created but charter failed`);
        } else {
          result.created += 1;
          log(`[seedNpcBanks] ${countryId}: created "${name}" (${key})`);
        }
      } catch (err) {
        result.charterFailures += 1;
        log(
          `[seedNpcBanks] ${countryId} slot ${index} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  log(
    `[seedNpcBanks] created=${result.created} existing=${result.skippedExisting} ` +
      `ineligibleSlots=${result.skippedIneligible} noStateSlots=${result.skippedNoState} ` +
      `excluded=${result.excludedMissingState.length} charterFailures=${result.charterFailures}`
  );
  if (result.charterFailures > 0) {
    throw new Error(
      `[seedNpcBanks] ${result.charterFailures} expected bank slot(s) failed to seed ` +
        `(created=${result.created}): ` +
        `bootstrap health must record this rather than ship bankless countries`
    );
  }
  return result;
}

/**
 * Call the real {@link issueCharter} path with the seed-time flag bypass.
 * Never mutates gameConfig: a crash mid-seed must not leave the world flag on.
 */
async function issueCharterWithFlag(
  db: Db,
  corporationId: ObjectId,
  currency: CurrencyCode
): Promise<boolean> {
  const result = await issueCharter(db, corporationId, "retail", currency, {
    skipFlagCheck: true,
  });
  return result.ok;
}

/**
 * For each active NPP-owned deposit-taking bank: if rate offsets have drifted
 * from target, push them back via {@link setBankRates} - deposits to the
 * lower quartile ({@link corridorDepositTarget}), lending to the midpoint.
 * Hold-reserve / lend-the-book behavior comes from bankingTurn's NPC flows.
 */
export async function runNpcBankPolicy(db: Db, _turn: number): Promise<NpcBankPolicySummary> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({
      ceoType: "npp",
      "bankCharter.status": "active",
      "bankCharter.type": { $in: ["retail", "universal"] },
    })
    .toArray();

  let banksUpdated = 0;
  for (const corp of corps) {
    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") continue;
    if (charter.type !== "retail" && charter.type !== "universal") continue;

    const countryId = getCountryIdForCurrency(charter.currency);
    const corridors = await getRateCorridors(db, countryId);
    const targetDeposit = corridorDepositTarget(
      corridors.deposit.minOffset,
      corridors.deposit.maxOffset
    );
    const midLending = corridorMidpoint(corridors.lending.minOffset, corridors.lending.maxOffset);

    if (
      offsetsMatch(charter.depositOffset, targetDeposit) &&
      offsetsMatch(charter.lendingOffset, midLending)
    ) {
      continue;
    }

    const setResult = await setBankRates(db, corp._id, targetDeposit, midLending);
    if (setResult.ok) banksUpdated += 1;
  }

  return { banksChecked: corps.length, banksUpdated };
}

/**
 * Turn-phase entry: no-op when private banking is off. Does not seed.
 */
export async function processNpcBankPolicyTurn(
  db: Db,
  turn: number
): Promise<NpcBankPolicySummary> {
  if (!(await isPrivateBankingEnabled())) {
    return { ...ZERO_POLICY };
  }
  return runNpcBankPolicy(db, turn);
}
