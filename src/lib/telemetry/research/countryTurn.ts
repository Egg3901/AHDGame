/**
 * Shell for the research country-turn panel (#2331, #2336).
 *
 * Runs once per turn from `stateEffectsPhase`, right after the long-horizon
 * context is resolved, so the row for turn N is written with the same state the
 * operational snapshots see. Six batched reads for the whole world, one bulk
 * upsert: never a query per country. Every access goes through the passed `Db`
 * handle, which on sim runs is the isolated sandbox database.
 *
 * Sovereign principal is the authoritative `federalBudget.debt.principal`
 * (resynced from the bond ledger); the flows come from the same ledger, so the
 * annual reconciliation in `buildAnnualFiscalPanel` exposes any drift between
 * the two instead of hiding it.
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getInflationTarget } from "@/lib/budget/inflation";
import { isBankGovernmentControlled } from "@/lib/centralBank/governance";
import { SYSTEM_RATE_ACTOR } from "@/lib/centralBank/rateHistory";
import { getCountryTurnTelemetryCollection } from "@/lib/db/collections/researchTelemetry";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { State } from "@/lib/db/types/state";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import type { LongHorizonContext } from "@/lib/telemetry/longHorizon/telemetry";
import {
  buildCountryTurnRow,
  sovereignFlowsForTurn,
  weightedMean,
  type CountryTurnRow,
} from "./rules";

/** Recent-first change from the bank's rate ledger when it landed on `turn`. */
function changeThisTurn(bank: CentralBank, turn: number) {
  if (bank.lastRateChangeTurn !== turn) return null;
  const last = bank.rateHistory?.[bank.rateHistory.length - 1];
  if (!last) return null;
  return {
    previousRate: last.previousRate,
    newRate: last.newRate,
    bySystem: String(last.changedBy) === String(SYSTEM_RATE_ACTOR),
  };
}

function conflictIdsByCountry(conflicts: readonly ConflictDoc[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of conflicts) {
    const countries = new Set<string>([...c.sideA.countries, ...c.sideB.countries]);
    for (const country of countries) {
      const list = out.get(country) ?? [];
      list.push(String(c._id));
      out.set(country, list);
    }
  }
  return out;
}

export async function buildCountryTurnRows(
  db: Db,
  ctx: LongHorizonContext,
  turn: number,
  observedAt: Date
): Promise<CountryTurnRow[]> {
  const [banks, budgets, rates, states, metrics, sovereignBonds, conflicts] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({ mergedInto: { $exists: false } })
      .toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    db
      .collection<State>("states")
      .find({}, { projection: { countryId: 1, gdp: 1, outputGap: 1, population: 1 } })
      .toArray(),
    db
      .collection<StateMetrics>("macroMetrics")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            "economic.unemploymentRate.value": 1,
            "economic.gdpGrowth.value": 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        {
          issuerType: "sovereign",
          $or: [
            { matured: { $ne: true } },
            { issuedAtTurn: turn },
            { redeemedAtTurn: turn },
            { defaultedAtTurn: turn },
          ],
        },
        {
          projection: {
            countryId: 1,
            matured: 1,
            defaulted: 1,
            totalIssued: 1,
            couponRate: 1,
            issuedAtTurn: 1,
            redeemedAtTurn: 1,
            defaultedAtTurn: 1,
          },
        }
      )
      .toArray(),
    listActiveConflicts(db),
  ]);

  const bankByCountry = new Map(banks.map((b) => [String(b.countryId), b]));
  const rateByCountry = new Map(rates.map((r) => [String(r.countryId), r]));
  const statesByCountry = new Map<string, State[]>();
  for (const s of states) {
    const list = statesByCountry.get(String(s.countryId)) ?? [];
    list.push(s);
    statesByCountry.set(String(s.countryId), list);
  }
  const metricsById = new Map(metrics.map((m) => [String(m._id), m]));
  const warsByCountry = conflictIdsByCountry(conflicts);

  const rows: CountryTurnRow[] = [];
  for (const budget of budgets) {
    const country = String(budget.countryId ?? budget._id);
    const countryId = country as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) continue;
    if (String(budget._id) !== getNationalBudgetId(countryId)) continue;

    const bank = bankByCountry.get(country);
    const fx = rateByCountry.get(country);
    const regions = statesByCountry.get(country) ?? [];
    const regionMetric = (s: State) => metricsById.get(String(s._id));
    const national = (() => {
      const id = getNationalDocId(countryId);
      return id ? metricsById.get(id) : undefined;
    })();
    const regionalGrowth = weightedMean(
      regions.map((s) => ({ value: regionMetric(s)?.economic?.gdpGrowth?.value, weight: s.gdp }))
    );
    const flows = sovereignFlowsForTurn(sovereignBonds, country, turn, TURNS_PER_YEAR);

    rows.push(
      buildCountryTurnRow({
        worldId: ctx.worldId,
        sourceClass: ctx.sourceClass,
        ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
        ...(ctx.seed !== undefined ? { seed: ctx.seed } : {}),
        ...(ctx.codeVersion !== undefined ? { codeVersion: ctx.codeVersion } : {}),
        turn,
        year: ctx.year,
        foundingTurn: ctx.foundingTurn,
        observedAt,
        country,
        currencyCode: fx?.currencyCode ?? null,
        macro: {
          inflationRate: budget.economicFactors?.inflationRate,
          targetInflation: getInflationTarget(countryId, ctx.year),
          primeRate: bank?.primeRate,
          effectiveRate: bank?.primeRateSmoothed ?? bank?.primeRate,
          gdpGrowth: national?.economic?.gdpGrowth?.value ?? regionalGrowth,
          outputGap: weightedMean(regions.map((s) => ({ value: s.outputGap, weight: s.gdp }))),
          unemploymentRate: weightedMean(
            regions.map((s) => ({
              value: regionMetric(s)?.economic?.unemploymentRate?.value,
              weight: s.population,
            }))
          ),
          wageGrowth: budget.economicFactors?.wageGrowth,
          tradeGrowth: budget.economicFactors?.tradeGrowth,
          gdp: budget.gdp,
        },
        monetary: {
          hasBank: !!bank,
          ...(bank
            ? {
                governmentControlled: isBankGovernmentControlled(bank, countryId, ctx.startingYear),
                hasCommittee: (bank.fomcBoard?.length ?? 0) > 0,
                chairIsPlayer: bank.chairMode !== "npp" && !!bank.chairCharacterId,
                lastRateChangeTurn: bank.lastRateChangeTurn,
                changeThisTurn: changeThisTurn(bank, turn),
              }
            : {}),
          fxRegime: fx?.fxRegime ?? "float",
          monetaryRegime: fx?.monetaryRegime ?? "pegged",
          capitalControls: fx?.capitalControls ?? false,
          exchangeRate: fx?.rate,
        },
        fiscal: {
          hasBudget: true,
          fiscalYear: budget.fiscalYear,
          revenue: budget.revenue as unknown as Record<string, unknown>,
          spending: budget.spending,
          surplus: budget.surplus,
          treasuryBalance: budget.treasuryBalance,
          debtPrincipal: budget.debt?.principal,
          debtInterestRate: budget.debt?.interestRate,
          debtToGdpRatio: budget.debtToGdpRatio,
          gdpSmoothed: budget.gdpSmoothed,
          creditRating: budget.creditRating,
          issuedFace: flows.issuedFace,
          retiredFace: flows.retiredFace,
          defaultedFace: flows.defaultedFace,
          scheduledCoupon: flows.scheduledCoupon,
        },
        conflictIds: warsByCountry.get(country) ?? [],
      })
    );
  }
  return rows;
}

/**
 * Record the country-turn rows for `turn`. Idempotent: a replayed turn replaces
 * its own rows (same coordinate) rather than adding a second observation.
 * Returns the number of rows written.
 */
export async function appendCountryTurnTelemetry(
  db: Db,
  ctx: LongHorizonContext,
  turn: number,
  observedAt: Date = new Date()
): Promise<number> {
  const rows = await buildCountryTurnRows(db, ctx, turn, observedAt);
  if (rows.length === 0) return 0;
  await getCountryTurnTelemetryCollection(db).bulkWrite(
    rows.map((row) => ({
      replaceOne: {
        filter: { worldId: row.worldId, country: row.country, turn: row.turn },
        replacement: row,
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return rows.length;
}
