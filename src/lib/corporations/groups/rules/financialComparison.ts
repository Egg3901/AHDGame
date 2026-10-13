import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { combineGroupLatest, type groupHistoryInAnchor } from "./financialHistory";
export type ComparisonPoint = NonNullable<ReturnType<typeof groupHistoryInAnchor>>;
export type ComparisonMetric = "revenue" | "income" | "cash";
export type FinancialBasis = "turn" | "day";
export interface ComparisonMember {
  id: string;
  name: string;
  history: readonly ComparisonPoint[] | null;
  currentCash: number | null;
  debt: number | null;
}
export function comparisonFlowFactor(basis: FinancialBasis) {
  return basis === "day" ? TURNS_PER_DAY : 1;
}
export function selectedFinancialSummary(members: readonly ComparisonMember[]) {
  const combined = combineGroupLatest(members.map((m) => m.history?.[0]));
  const latest =
    combined && [combined.revenue, combined.costs, combined.income].every(Number.isFinite)
      ? combined
      : null;
  const sum = (key: "currentCash" | "debt") => {
    if (!members.length || members.some((m) => m[key] === null || !Number.isFinite(m[key])))
      return null;
    const total = members.reduce((n, m) => n + m[key]!, 0);
    return Number.isFinite(total) ? total : null;
  };
  const margin = latest && latest.revenue > 0 ? (latest.income / latest.revenue) * 100 : null;
  return {
    latest,
    margin: margin !== null && Number.isFinite(margin) ? margin : null,
    cash: sum("currentCash"),
    debt: sum("debt"),
  };
}
/** Shared equally-spaced chart: retain only the latest consecutive complete series. */
export function comparisonHistory(
  members: readonly ComparisonMember[],
  metric: ComparisonMetric,
  turn: number,
  range: 12 | 24 | 48,
  basis: FinancialBasis
) {
  const byTurn = members.map((m) => new Map((m.history ?? []).map((p) => [p.turn, p])));
  const all: { turn: number; values: number[] }[] = [];
  if (members.length)
    for (let t = Math.max(0, turn - range + 1); t <= turn; t++) {
      const values = byTurn.map((rows) => {
        const value = rows.get(t)?.[metric];
        return value === undefined
          ? undefined
          : value * (metric === "cash" ? 1 : comparisonFlowFactor(basis));
      });
      if (values.every((v) => v !== undefined && Number.isFinite(v)))
        all.push({
          turn: t,
          values: values as number[],
        });
    }
  const consecutive: typeof all = [];
  for (const p of all) {
    if (consecutive.length && p.turn !== consecutive[consecutive.length - 1].turn + 1)
      consecutive.length = 0;
    consecutive.push(p);
  }
  return { all, consecutive };
}
export type ComparisonSort = "name" | "revenue" | "costs" | "income" | "cash" | "debt";
/** Unknown values stay last in either direction. */
export function sortComparisonMembers(
  members: readonly ComparisonMember[],
  key: ComparisonSort,
  direction: 1 | -1
) {
  const value = (m: ComparisonMember) =>
    key === "name"
      ? m.name
      : key === "cash"
        ? m.currentCash
        : key === "debt"
          ? m.debt
          : (m.history?.[0]?.[key] ?? null);
  return [...members].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
    if (bv === null) return -1;
    return (
      direction *
        (typeof av === "string"
          ? av < (bv as string)
            ? -1
            : av > (bv as string)
              ? 1
              : 0
          : (av as number) - (bv as number)) || a.id.localeCompare(b.id)
    );
  });
}
export function groupBondDebt(
  ids: readonly string[],
  bonds: readonly {
    corporationId: string;
    principal: number;
    currencyCode?: string;
    countryId?: string;
  }[],
  rates: ReadonlyMap<string, number>
) {
  const debt = new Map<string, number | null>(ids.map((id) => [id, 0]));
  for (const bond of bonds) {
    if (!debt.has(bond.corporationId)) continue;
    const code =
      bond.currencyCode ??
      (bond.countryId
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined);
    const rate = code ? rates.get(code) : 1;
    const amount =
      rate &&
      rate > 0 &&
      Number.isFinite(rate) &&
      Number.isFinite(bond.principal) &&
      bond.principal >= 0
        ? bond.principal / rate
        : null;
    const previous = debt.get(bond.corporationId);
    const combined = previous == null || amount === null ? null : previous + amount;
    debt.set(bond.corporationId, combined !== null && Number.isFinite(combined) ? combined : null);
  }
  return debt;
}
export function comparisonCsv(
  rows: readonly ComparisonMember[],
  basis: FinancialBasis,
  headers: readonly string[]
) {
  const factor = comparisonFlowFactor(basis);
  const escape = (value: string | number | null | undefined) =>
    '"' +
    (typeof value === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(value)
      ? "'" + value
      : typeof value === "number" && !Number.isFinite(value)
        ? ""
        : String(value ?? "")
    ).replace(/"/g, '""') +
    '"';
  return (
    "\uFEFF" +
    [
      headers,
      ...rows.map((m) => [
        m.name,
        m.history?.[0]?.turn,
        m.history?.[0]?.revenue == null ? null : m.history[0].revenue * factor,
        m.history?.[0]?.costs == null ? null : m.history[0].costs * factor,
        m.history?.[0]?.income == null ? null : m.history[0].income * factor,
        m.currentCash,
        m.debt,
        basis,
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
