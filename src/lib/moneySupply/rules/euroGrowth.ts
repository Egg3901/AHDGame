/**
 * Common-area money growth combines legacy ledger stocks at their locked euro
 * ratios. euroMoneyGrowth compares complete, simultaneous observations after
 * the latest accession and counts shared ledger currencies only once.
 */
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { EuroMonetaryUnion } from "@/lib/currency/euro/rules";
import {
  annualizedMoneyGrowthPct,
  MONEY_ACCOUNTING_VERSION,
  MIN_MONEY_GROWTH_BASE_TURNS,
} from "./calculate";

export interface EuroMoneyObservation {
  currencyCode: CurrencyCode;
  turn: number;
  accountingVersion?: number;
  m2: number;
}

export function euroMoneyGrowth(
  union: EuroMonetaryUnion,
  observations: readonly EuroMoneyObservation[],
  currentTurn: number
): number | null {
  const currencies = new Map<CurrencyCode, number>();
  let cohortStart = union.establishedTurn;
  if (!Number.isSafeInteger(cohortStart) || !Number.isSafeInteger(currentTurn)) return null;
  for (const member of Object.values(union.members)) {
    if (!member) continue;
    const ratio = member.ledgerUnitsPerAnchorUnit;
    if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isSafeInteger(member.joinedTurn))
      return null;
    const existing = currencies.get(member.ledgerCurrency);
    if (existing != null && existing !== ratio) return null;
    currencies.set(member.ledgerCurrency, ratio);
    cohortStart = Math.max(cohortStart, member.joinedTurn);
  }
  if (!currencies.size) return null;
  const byTurn = new Map<number, Map<CurrencyCode, number>>();
  for (const observation of observations) {
    if (
      !currencies.has(observation.currencyCode) ||
      observation.accountingVersion !== MONEY_ACCOUNTING_VERSION ||
      !Number.isSafeInteger(observation.turn) ||
      observation.turn < cohortStart ||
      observation.turn > currentTurn ||
      !Number.isFinite(observation.m2) ||
      observation.m2 < 0
    )
      continue;
    const row = byTurn.get(observation.turn) ?? new Map<CurrencyCode, number>();
    // Conflicting observations cannot establish a comparable total.
    if (row.has(observation.currencyCode)) return null;
    row.set(observation.currencyCode, observation.m2);
    byTurn.set(observation.turn, row);
  }
  const completeTurns = [...byTurn.keys()]
    .filter((turn) => byTurn.get(turn)!.size === currencies.size)
    .sort((a, b) => b - a);
  const latest = completeTurns[0];
  // A stale complete cohort must not hide an incomplete current observation.
  if (latest == null || latest < currentTurn - 1) return null;
  const prior = completeTurns.find((turn) => turn <= latest - MIN_MONEY_GROWTH_BASE_TURNS);
  if (prior == null) return null;
  const totalAt = (turn: number) =>
    [...currencies].reduce(
      (total, [currency, ratio]) => total + byTurn.get(turn)!.get(currency)! / ratio,
      0
    );
  const priorTotal = totalAt(prior);
  const latestTotal = totalAt(latest);
  if (!Number.isFinite(priorTotal) || !Number.isFinite(latestTotal)) return null;
  return annualizedMoneyGrowthPct(priorTotal, latestTotal, latest - prior);
}
