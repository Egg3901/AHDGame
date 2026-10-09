import type { AnyBulkWriteOperation, Db } from "mongodb";
import {
  CYCLE_PRESSURE_BY_REGIME,
  INITIAL_RATES,
  getCountryIdForCurrency,
  getInitialRates,
  getSeedCurrencyCode,
  reserveCurrencyVolatilityMultiplier,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { rankReserveCurrencies } from "@/lib/centralBank/reserveCurrencyRanking";
import { computeFractionalRateUpdate } from "@/lib/currency/rateCalculation";
import { computeCurrencyVolumes, type CurrencyVolumeMap } from "@/lib/currency/volumeTracker";
import { linkedEuroRates, type EuroMonetaryUnion } from "@/lib/currency/euro/rules";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import {
  BW_FLOATING_DRIFT_MULTIPLIER,
  BW_PEGGED_BAND,
  bandMultiplierFor,
  participatesInFloat,
  resolveMonetaryRegime,
} from "@/lib/monetary/brettonWoods";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";
import { extractMacroInputs } from "@/lib/turn/forexTurn";
import { yearOfTurn } from "@/lib/utils/gameDate";
import { HALF_TICK_FRACTION, hasSubhourStep, subhourStepStamp } from "./stepFraction";

/**
 * :30 half step for forex, under the stepFraction.ts contract: each floating
 * currency takes HALF_TICK_FRACTION of the coming turn's rate step and is
 * stamped with subhourStep in the same update; the turn applies the rest.
 *
 * Only the rate moves. Interventions, limit-order fills and expiry, the
 * 12-turn cycle regime roll, the rateHistory append, centralBanks writes and
 * the volume-window fields all stay on the hourly turn, so charts stay hourly
 * and orders still fill once an hour at the turn's rate.
 *
 * Mirrors processForexTurn for what each currency does: hard pegs and
 * command-economy pegs hold (no write), euro followers and union members copy
 * the anchor's new quote, and Bretton Woods band and drift come from the
 * stored regime. The macro target is recomputed from the current central-bank
 * inputs, so it can differ from the turn's if a prime rate or a macro series
 * moved in between; the turn's remainder then pulls toward the newer target,
 * which is intended (the rate follows the latest information).
 */

export type ForexHalfStepRow = Pick<
  ExchangeRate,
  | "_id"
  | "countryId"
  | "currencyCode"
  | "rate"
  | "baseRate"
  | "hardPeg"
  | "cyclePressureRegime"
  | "cyclePressureUntilTurn"
  | "monetaryRegime"
  | "monetaryRegimeSetAtTurn"
  | "subhourStep"
>;

export interface ForexHalfStepWrite {
  countryId: string;
  prevRate: number;
  rate: number;
  macroTarget: number;
  /** Set when this row copies an anchor quote computed in the same run. */
  followsAnchor?: string;
}

export interface ForexHalfStepPlan {
  writes: ForexHalfStepWrite[];
  /** Euro anchor whose new quote followers copy, when it moved this run. */
  anchorCountryId: string | null;
  pegged: number;
  alreadyStepped: number;
}

export interface ForexHalfStepInputs {
  turn: number;
  fraction: number;
  preset: string;
  currentYear: number;
  commandEconomyEnabled: boolean;
  rows: ForexHalfStepRow[];
  banks: CentralBank[];
  volumes: Partial<CurrencyVolumeMap>;
  euroUnion?: EuroMonetaryUnion;
  /** Test seam for the uniform jitter; omitted = Math.random noise. */
  noise?: () => number | undefined;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Pure: what the :30 tick writes. Mirrors processForexTurn's per-country branches. */
export function planForexHalfStep(input: ForexHalfStepInputs): ForexHalfStepPlan {
  const { turn, preset, euroUnion } = input;
  const eraInitialRates = getInitialRates(preset);
  const activeCountries = getPresetMonetaryScope(preset).forexCountries;
  const bankMap = new Map(input.banks.map((b) => [b.countryId, b]));
  const rateMap = new Map(input.rows.map((r) => [r._id, r]));
  const ratesByCurrency: Partial<Record<CurrencyCode, number>> = Object.fromEntries(
    input.rows.map((row) => [row.currencyCode, row.rate])
  ) as Partial<Record<CurrencyCode, number>>;

  // Same ranking input as the turn: pre-update rates and reserve holdings.
  const reserveVolatility = new Map<CurrencyCode, number>();
  for (const entry of rankReserveCurrencies(input.banks, ratesByCurrency)) {
    reserveVolatility.set(entry.currencyCode, reserveCurrencyVolatilityMultiplier(entry.rank));
  }

  const euroAnchorCountry = getCountryIdForCurrency("EUR");
  const deRow = rateMap.get(euroAnchorCountry);
  let euroAnchorRate: number | null = null;
  let euroAnchorMacroTarget: number | null = null;
  let anchorCountryId: string | null = null;
  const writes: ForexHalfStepWrite[] = [];
  let pegged = 0;
  let alreadyStepped = 0;

  for (const countryId of activeCountries) {
    if (euroUnion?.members[countryId] && countryId !== euroUnion.anchorCountryId) continue;
    const bank = bankMap.get(countryId);
    const row = rateMap.get(countryId);
    // A missing row is seeded by the turn, never here.
    if (!bank || !row) continue;

    const isEuroAnchor = countryId === euroAnchorCountry;
    const isEuroFollower =
      !isEuroAnchor &&
      (getSeedCurrencyCode(countryId, preset) === "EUR" || row.currencyCode === "EUR");
    const currencyCode = isEuroFollower ? "EUR" : getSeedCurrencyCode(countryId, preset);
    const seedBaseRate = isEuroFollower
      ? (eraInitialRates.DE ?? INITIAL_RATES.DE)
      : (eraInitialRates[countryId] ?? INITIAL_RATES[countryId]);
    if (seedBaseRate === undefined || !currencyCode) continue;
    const baseRate = finiteOr(row.baseRate, seedBaseRate);

    if (hasSubhourStep(row.subhourStep, turn)) {
      // A rerun of this tick: the half is already in. Followers keep tracking
      // the anchor's stored quote.
      alreadyStepped++;
      if (isEuroAnchor && positive(row.rate)) euroAnchorRate = row.rate;
      continue;
    }
    // A non-finite stored rate is healed by the turn.
    if (!positive(row.rate)) continue;

    const commandActive = isCommandEconomy(
      countryId,
      input.currentYear,
      input.commandEconomyEnabled
    );
    if ((row.hardPeg ?? (commandActive ? baseRate : null)) != null) {
      pegged++;
      continue;
    }

    if (isEuroFollower) {
      const pegRate = euroAnchorRate ?? (deRow && positive(deRow.rate) ? deRow.rate : null);
      if (pegRate == null || pegRate === row.rate) continue;
      writes.push({
        countryId,
        prevRate: row.rate,
        rate: pegRate,
        macroTarget: euroAnchorMacroTarget ?? pegRate,
        ...(anchorCountryId ? { followsAnchor: anchorCountryId } : {}),
      });
      continue;
    }

    // The regime in force for the coming turn. One that expires at that turn
    // is re-rolled there, so the half step takes no cycle pressure and the
    // turn applies the new regime's remaining half.
    const regime = row.cyclePressureRegime ?? null;
    const until = row.cyclePressureUntilTurn ?? null;
    const cyclePressure =
      regime != null && until != null && turn < until ? CYCLE_PRESSURE_BY_REGIME[regime] : 0;

    const bwRegime = resolveMonetaryRegime(row.monetaryRegime);
    const bwFloats = bwRegime !== "pegged" && participatesInFloat(countryId, commandActive);
    const bwBand = bwFloats
      ? bandMultiplierFor({
          regime: bwRegime === "floating" ? "floating" : "suspended",
          turnsSinceRegimeChange: turn - finiteOr(row.monetaryRegimeSetAtTurn, turn),
        })
      : BW_PEGGED_BAND;

    const vol = input.volumes[currencyCode] ?? { buyVolume24: 0, sellVolume24: 0 };
    const update = computeFractionalRateUpdate(
      row.rate,
      baseRate,
      countryId,
      extractMacroInputs(bank),
      {
        buyVolume24: finiteOr(vol.buyVolume24, 0),
        sellVolume24: finiteOr(vol.sellVolume24, 0),
        ...(Number.isFinite(vol.effectiveTraders)
          ? { effectiveTraders: vol.effectiveTraders }
          : {}),
      },
      input.fraction,
      input.noise?.(),
      reserveVolatility.get(currencyCode) ?? 1,
      cyclePressure,
      input.currentYear,
      bwBand,
      bwFloats ? BW_FLOATING_DRIFT_MULTIPLIER : 1
    );
    if (!positive(update.rate) || !Number.isFinite(update.macroTarget)) continue;

    writes.push({
      countryId,
      prevRate: row.rate,
      rate: update.rate,
      macroTarget: update.macroTarget,
    });
    if (isEuroAnchor) {
      euroAnchorRate = update.rate;
      euroAnchorMacroTarget = update.macroTarget;
      anchorCountryId = countryId;
    }
    if (euroUnion && countryId === euroUnion.anchorCountryId) {
      ratesByCurrency[currencyCode] = update.rate;
    }
  }

  if (euroUnion) {
    let linked: Partial<Record<CurrencyCode, number>> | null = null;
    try {
      linked = linkedEuroRates(euroUnion, ratesByCurrency);
    } catch {
      // No usable anchor quote: members stay put until the turn.
      linked = null;
    }
    for (const member of Object.values(euroUnion.members)) {
      if (!linked || !member || member.countryId === euroUnion.anchorCountryId) continue;
      const row = rateMap.get(member.countryId);
      const rate = linked[member.ledgerCurrency];
      if (!row || !positive(rate) || !positive(row.rate) || rate === row.rate) continue;
      if (hasSubhourStep(row.subhourStep, turn)) {
        alreadyStepped++;
        continue;
      }
      writes.push({
        countryId: member.countryId,
        prevRate: row.rate,
        rate,
        macroTarget: rate,
        ...(anchorCountryId ? { followsAnchor: anchorCountryId } : {}),
      });
    }
  }

  return { writes, anchorCountryId, pegged, alreadyStepped };
}

function writeOp(
  write: ForexHalfStepWrite,
  turn: number,
  fraction: number,
  now: Date
): AnyBulkWriteOperation<ExchangeRate> {
  return {
    updateOne: {
      // CAS: a rate changed since the read (admin edit, a turn that started)
      // wins, as does an admin peg, and a rerun cannot apply a second half.
      filter: {
        _id: write.countryId,
        rate: write.prevRate,
        hardPeg: null,
        "subhourStep.turn": { $ne: turn },
      },
      update: {
        $set: {
          rate: write.rate,
          macroTarget: write.macroTarget,
          subhourStep: subhourStepStamp(turn, fraction),
          updatedAt: now,
        },
      },
    },
  };
}

const ROW_PROJECTION = {
  countryId: 1,
  currencyCode: 1,
  rate: 1,
  baseRate: 1,
  hardPeg: 1,
  cyclePressureRegime: 1,
  cyclePressureUntilTurn: 1,
  monetaryRegime: 1,
  monetaryRegimeSetAtTurn: 1,
  subhourStep: 1,
} as const;

const BANK_PROJECTION = {
  countryId: 1,
  primeRate: 1,
  tradeGrowth: 1,
  spreadFeeReserveBalances: 1,
  inflationHistory: { $slice: -1 },
  gdpGrowthHistory: { $slice: -1 },
} as const;

/**
 * Apply the :30 forex half step. `turn` is the coming turn (currentTurn + 1).
 * Reads: gameState, gameConfig, centralBanks and exchangeRates (projected, in
 * parallel), then the trade window. Writes: one CAS update for the euro anchor
 * when it moved, then one unordered bulkWrite for everything else.
 */
export async function runForexHalfStep(
  db: Db,
  turn: number,
  now: Date
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const state = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentTurn: 1,
        isProcessing: 1,
        forexEnabled: 1,
        preset: 1,
        startingYear: 1,
        preIteration: 1,
        preIterationTurns: 1,
        euroMonetaryUnion: 1,
      },
    }
  );
  if (!state?.forexEnabled) return { skipped: "forexDisabled" };
  // The turn this half belongs to already started or ran: it took the full step.
  if (state.isProcessing || state.currentTurn + 1 !== turn) return { skipped: "turnAdvanced" };

  const preset = state.preset ?? DEFAULT_SEED_PRESET;
  const currentYear = yearOfTurn(turn, state.startingYear ?? STARTING_YEAR, {
    preIterationActive: state.preIteration?.active,
    preIterationTurns: state.preIterationTurns,
  });
  const euroUnion = state.euroMonetaryUnion;

  const [rows, banks, gameConfig] = await Promise.all([
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({}, { projection: ROW_PROJECTION })
      .toArray() as Promise<ForexHalfStepRow[]>,
    db.collection<CentralBank>("centralBanks").find({}, { projection: BANK_PROJECTION }).toArray(),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
  ]);
  const volumes = await computeCurrencyVolumes(
    db,
    turn,
    euroUnion,
    new Map(rows.map((r) => [r.currencyCode, r.rate]))
  );

  const plan = planForexHalfStep({
    turn,
    fraction: HALF_TICK_FRACTION,
    preset,
    currentYear,
    commandEconomyEnabled: gameConfig?.commandEconomyEnabled === true,
    rows,
    banks,
    volumes,
    euroUnion,
  });

  const collection = db.collection<ExchangeRate>("exchangeRates");
  let written = 0;
  let casSkipped = 0;

  // The anchor goes first: followers copy its new quote only if it landed.
  let anchorLanded = true;
  const anchorWrite = plan.writes.find((w) => w.countryId === plan.anchorCountryId);
  if (anchorWrite) {
    const result = await collection.bulkWrite([
      writeOp(anchorWrite, turn, HALF_TICK_FRACTION, now),
    ]);
    anchorLanded = result.matchedCount === 1;
    if (anchorLanded) written++;
    else casSkipped++;
  }

  const rest = plan.writes.filter(
    (w) => w !== anchorWrite && (anchorLanded || w.followsAnchor == null)
  );
  casSkipped += plan.writes.length - (anchorWrite ? 1 : 0) - rest.length;
  if (rest.length > 0) {
    const result = await collection.bulkWrite(
      rest.map((w) => writeOp(w, turn, HALF_TICK_FRACTION, now)),
      { ordered: false }
    );
    written += result.matchedCount;
    casSkipped += rest.length - result.matchedCount;
  }

  return {
    turn,
    fraction: HALF_TICK_FRACTION,
    written,
    casSkipped,
    pegged: plan.pegged,
    alreadyStepped: plan.alreadyStepped,
    ms: Date.now() - started,
  };
}
