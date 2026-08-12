import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
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
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

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
};

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
const COUNTRY_HISTORICAL_NAMES: Partial<Record<CountryId, readonly string[]>> = {
  US: ["Continental Merchants Bank", "Prairie States Savings Bank"],
  UK: ["Midland Counties Bank", "Clydeside Mercantile Bank"],
  JP: ["Kanto Commercial Bank", "Osaka Harbour Trust"],
  DE: ["Rhineland Credit Bank", "Hanseatic Merchants Bank"],
  FR: ["Banque du Littoral", "Comptoir des Provinces"],
  IT: ["Banca Adriatica", "Credito Tirreno"],
  ES: ["Banco del Ebro", "Caja Mercantil del Norte"],
  IE: ["Hibernian Provincial Bank", "Shannon Valley Bank"],
  BR: ["Banco Paulista de Comercio", "Banco Atlantico do Sul"],
  NG: ["Niger Delta Trading Bank", "Savannah Merchants Bank"],
  SE: ["Svea Merchants Bank", "Norrland Savings Bank"],
  TR: ["Anatolian Commerce Bank", "Bosphorus Trading Bank"],
  GR: ["Aegean Merchants Bank", "Peloponnese Savings Bank"],
  AT: ["Alpine Credit Bank", "Danube Commercial Bank"],
  FI: ["Lakeland Savings Bank", "Bothnia Commercial Bank"],
};

const COUNTRY_MODERN_NAMES: Partial<Record<CountryId, readonly string[]>> = {
  US: ["Continental Merchants Bancorp", "Prairie States Financial"],
  UK: ["Midland Counties Banking Group", "Clydeside Financial"],
  JP: ["Kanto Commercial Banking Group", "Osaka Harbour Financial"],
  DE: ["Rhineland Credit Group", "Hanseatic Banking Group"],
  FR: ["Groupe Bancaire du Littoral", "Comptoir des Provinces"],
  IT: ["Banca Adriatica Group", "Credito Tirreno"],
  ES: ["Banco del Ebro", "Grupo Mercantil del Norte"],
  IE: ["Hibernian Banking Group", "Shannon Valley Financial"],
  BR: ["Banco Paulista de Comercio", "Atlantico Sul Financial"],
  NG: ["Niger Delta Banking Group", "Savannah Financial"],
  SE: ["Svea Banking Group", "Norrland Financial"],
  TR: ["Anatolian Commerce Group", "Bosphorus Financial"],
  GR: ["Aegean Banking Group", "Peloponnese Financial"],
  AT: ["Alpine Credit Group", "Danube Banking Group"],
  FI: ["Lakeland Financial", "Bothnia Banking Group"],
};

function corridorMidpoint(minOffset: number, maxOffset: number): number {
  return (minOffset + maxOffset) / 2;
}

function offsetsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= OFFSET_DRIFT_EPSILON;
}

/**
 * Seed NPP-run retail banks for every non-command country that can host a
 * financial NPP corp (capital HQ configured). Idempotent via `npcBankSeedKey`.
 *
 * Seeding is not gated on `privateBankingEnabled`: charters are written through
 * the real {@link issueCharter} path with the seed-time skipFlagCheck bypass
 * (gameConfig is never mutated). Runtime policy/turn behavior still requires
 * the flag.
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
  };

  const eraUnitScale = await loadWorldEraUnitScale(db);
  const historicalEra = eraUnitScale > 1;

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
      `ineligibleSlots=${result.skippedIneligible} charterFailures=${result.charterFailures}`
  );
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
 * from corridor midpoints, push them back via {@link setBankRates}.
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
    const midDeposit = corridorMidpoint(corridors.deposit.minOffset, corridors.deposit.maxOffset);
    const midLending = corridorMidpoint(corridors.lending.minOffset, corridors.lending.maxOffset);

    if (
      offsetsMatch(charter.depositOffset, midDeposit) &&
      offsetsMatch(charter.lendingOffset, midLending)
    ) {
      continue;
    }

    const setResult = await setBankRates(db, corp._id, midDeposit, midLending);
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
