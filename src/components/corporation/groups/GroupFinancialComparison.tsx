"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, ArrowUpDown } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { DenseLineChart } from "../dense/DenseLineChart";
import {
  comparisonFlowFactor,
  comparisonHistory,
  comparisonCsv,
  selectedFinancialSummary,
  sortComparisonMembers,
  type ComparisonSort,
  type ComparisonMetric,
  type FinancialBasis,
} from "@/lib/corporations/groups/rules/financialComparison";
import type { GroupBalanceSheet } from "@/lib/corporations/groups/groupBalanceSheet";
import type { GroupManagementView } from "./useGroupManagement";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium hover:bg-card-elevated disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-info";
const tones = ["text-gold", "text-info", "text-secondary", "text-success"];
const columns: ComparisonSort[] = ["name", "revenue", "costs", "income", "cash", "debt"];
export function GroupFinancialComparison({
  data,
  sheet,
}: {
  data: GroupManagementView;
  sheet: GroupBalanceSheet | null;
}) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const [selection, setSelection] = useState<string[] | null>(null),
    [basis, setBasis] = useState<FinancialBasis>("turn"),
    [currency, setCurrency] = useState<"preferred" | "anchor">("preferred"),
    [metric, setMetric] = useState<ComparisonMetric>("revenue"),
    [range, setRange] = useState<12 | 24 | 48>(24),
    [sort, setSort] = useState<{ key: ComparisonSort; direction: 1 | -1 }>({
      key: "revenue",
      direction: -1,
    });
  const chosen = selection ?? data.members.map((m) => m.id),
    ids = new Set(chosen);
  const validSheet =
    sheet &&
    sheet.members.length === data.members.length &&
    data.members.every((m) => sheet.members.some((s) => s.corporationId === m.id))
      ? sheet
      : null;
  const selected = data.members
    .filter((m) => ids.has(m.id))
    .map((m) => ({
      ...m,
      currentCash:
        validSheet?.members.find((s) => s.corporationId === m.id)?.liquidCapitalAnchor ?? null,
      debt: m.currentDebtAnchor ?? null,
    }));
  const rows = sortComparisonMembers(selected, sort.key, sort.direction);
  const totals = selectedFinancialSummary(selected),
    history = comparisonHistory(selected, metric, data.currentTurn, range, basis),
    factor = comparisonFlowFactor(basis);
  const baseFormat =
    currency === "anchor" ? (n: number) => formatFundsCompact(n, "₳") : formatAmount;
  const format = (n: number) => (Number.isFinite(n) ? baseFormat(n) : t("unavailable"));
  const amount = (n: number | null | undefined) => (n == null ? t("unavailable") : format(n));
  const label = (key: ComparisonSort) => t("comparisonColumns." + key);
  const tone = (id: string) => tones[data.members.findIndex((m) => m.id === id) % tones.length];
  function download() {
    const csv = comparisonCsv(rows, basis, [
      t("member"),
      t("turnLabel"),
      label("revenue"),
      label("costs"),
      label("income"),
      label("cash"),
      label("debt"),
      t("financialBasis"),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      a = document.createElement("a");
    a.href = url;
    a.download = "subsidiary-group-" + basis + "-anchor.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  const chartName = t("comparisonTrend", { metric: t("chartMetrics." + metric) });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("financials")}</h2>
          <p className="mt-1 text-sm text-muted">{t("comparisonIntro")}</p>
        </div>
        <button type="button" className={button} disabled={!selected.length} onClick={download}>
          <Download size={15} aria-hidden="true" />
          {t("export")}
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="text-xs text-muted">
          {t("financialBasis")}
          <select
            className="ml-2 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label={t("financialBasis")}
            value={basis}
            onChange={(e) => setBasis(e.target.value as FinancialBasis)}
          >
            <option value="turn">{t("perTurn")}</option>
            <option value="day">{t("perGameDay")}</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          {t("comparisonCurrency")}
          <select
            className="ml-2 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label={t("comparisonCurrency")}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "preferred" | "anchor")}
          >
            <option value="preferred">{t("preferredCurrency")}</option>
            <option value="anchor">{t("anchorCurrency")}</option>
          </select>
        </label>
      </div>
      {data.members.some((m) => m.history === null) && (
        <p className="rounded-lg border border-info/25 bg-info/5 p-4 text-sm text-muted">
          {t("comparisonPrivate")}
        </p>
      )}
      <section
        className="rounded-xl border border-card-border bg-card p-4 space-y-3"
        aria-label={t("compareMembers")}
      >
        <div className="flex flex-wrap gap-2">
          {data.members.map((m) => (
            <label
              key={m.id}
              className={`flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm ${ids.has(m.id) ? "border-gold/50 bg-gold/5" : "border-card-border text-muted"}`}
            >
              <input
                className="h-4 w-4 accent-primary"
                type="checkbox"
                checked={ids.has(m.id)}
                onChange={(e) =>
                  setSelection(
                    e.target.checked ? [...chosen, m.id] : chosen.filter((id) => id !== m.id)
                  )
                }
              />
              <span className="min-w-0 break-words">{m.name}</span>
              <span className={`shrink-0 ${tone(m.id)}`} aria-hidden="true">
                ●
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={() => setSelection(data.members.map((m) => m.id))}
          >
            {t("selectAll")}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setSelection(data.members.filter((m) => !m.isRoot).map((m) => m.id))}
          >
            {t("subsidiariesOnly")}
          </button>
          <button type="button" className={button} onClick={() => setSelection([])}>
            {t("clear")}
          </button>
        </div>
      </section>
      <p className="text-xs text-muted">
        {t("selectionCount", { count: selected.length, total: data.members.length })}
        {totals.latest
          ? " · " + t("observationTurn", { turn: totals.latest.turn })
          : selected.length
            ? " · " + t("commonTurnUnavailable")
            : ""}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            title: t("selectedRevenue"),
            value: totals.latest ? format(totals.latest.revenue * factor) : t("unavailable"),
          },
          {
            title: t("selectedIncome"),
            value: totals.latest ? format(totals.latest.income * factor) : t("unavailable"),
          },
          {
            title: t("weightedMargin"),
            value:
              totals.margin == null
                ? t("unavailable")
                : t("percentage", { percent: Number(totals.margin.toFixed(1)) }),
          },
          { title: t("selectedCash"), value: amount(totals.cash) },
        ].map((m) => (
          <div key={m.title} className="min-w-0 border-l-2 border-card-border pl-4">
            <dt className="text-xs text-muted">{m.title}</dt>
            <dd className="mt-1 break-words font-mono text-2xl font-semibold tabular-nums">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">{t("comparisonBasisNote")}</p>
      <section className="min-w-0 overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("comparisonTable")}</caption>
            <thead>
              <tr>
                {columns.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      sort.key === key
                        ? sort.direction === 1
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-info"
                      onClick={() =>
                        setSort({
                          key,
                          direction: sort.key === key && sort.direction === 1 ? -1 : 1,
                        })
                      }
                    >
                      {label(key)}
                      {sort.key === key ? (
                        <span aria-hidden="true">{sort.direction === 1 ? "↑" : "↓"}</span>
                      ) : (
                        <ArrowUpDown size={12} aria-hidden="true" />
                      )}
                    </button>
                  </th>
                ))}
                <th scope="col">{t("turnLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const m = data.members.find((m) => m.id === row.id)!,
                    point = row.history?.[0];
                  return (
                    <tr key={row.id}>
                      <th
                        scope="row"
                        className="min-w-48 !bg-transparent !text-foreground !text-sm !font-normal"
                      >
                        <Link
                          href={"/corporation/" + m.pathId}
                          className="font-medium hover:underline"
                        >
                          {row.name}
                        </Link>
                        <small className="mt-1 block text-muted">
                          {!m.isRoot && m.parentControl
                            ? t("parentVotingControl", {
                                parent:
                                  data.members.find((c) => c.id === m.parentControl!.corporationId)
                                    ?.name ?? t("parentCorporation"),
                                percent: m.parentControl.votingPercent,
                              })
                            : t(m.isRoot ? "parentLabel" : "subsidiaryLabel")}{" "}
                          · {t(m.operator === "npp" ? "npp" : "player")}
                        </small>
                      </th>
                      {(["revenue", "costs", "income"] as const).map((k) => (
                        <td
                          key={k}
                          className={
                            k === "income" && point
                              ? point.income < 0
                                ? "text-error"
                                : point.income > 0
                                  ? "text-success"
                                  : ""
                              : ""
                          }
                        >
                          {point
                            ? format(point[k] * factor)
                            : row.history === null
                              ? t("privateFinancial")
                              : t("unavailable")}
                        </td>
                      ))}
                      <td>{amount(row.currentCash)}</td>
                      <td>
                        {row.debt == null && row.history === null
                          ? t("privateFinancial")
                          : amount(row.debt)}
                      </td>
                      <td>{point?.turn ?? t("unavailable")}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="!py-10 !text-center text-muted">
                    {t("noComparisonMembers")}
                  </td>
                </tr>
              )}
            </tbody>
            {selected.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row">{t("selectedTotal")}</th>
                  <td>{amount(totals.latest ? totals.latest.revenue * factor : null)}</td>
                  <td>{amount(totals.latest ? totals.latest.costs * factor : null)}</td>
                  <td>{amount(totals.latest ? totals.latest.income * factor : null)}</td>
                  <td>{amount(totals.cash)}</td>
                  <td>{amount(totals.debt)}</td>
                  <td>{totals.latest?.turn ?? t("unavailable")}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="border-t border-card-border p-4 text-xs text-muted">
          {t("comparisonCombinedNote")}
        </p>
      </section>
      <section className="min-w-0 rounded-xl border border-card-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border p-1"
            role="group"
            aria-label={t("chartMetric")}
          >
            {(["revenue", "income", "cash"] as const).map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={metric === k}
                className={`rounded-md px-3 py-1 text-xs ${metric === k ? "bg-card-elevated" : "text-muted"}`}
                onClick={() => setMetric(k)}
              >
                {t("chartMetrics." + k)}
              </button>
            ))}
          </div>
          <div
            className="inline-flex gap-1 rounded-lg border border-card-border p-1"
            role="group"
            aria-label={t("trendRange")}
          >
            {([12, 24, 48] as const).map((n) => (
              <button
                type="button"
                key={n}
                aria-pressed={range === n}
                className={`rounded-md px-2 py-1 text-xs ${range === n ? "bg-card-elevated" : "text-muted"}`}
                onClick={() => setRange(n)}
              >
                {t("turnRange", { count: n })}
              </button>
            ))}
          </div>
        </div>
        <h3 className="font-semibold">{chartName}</h3>
        {history.consecutive.length >= 2 ? (
          <DenseLineChart
            turns={history.consecutive.map((p) => p.turn)}
            series={selected.map((m, i) => ({
              label: m.name,
              values: history.consecutive.map((p) => p.values[i]),
              tone: tone(m.id),
              dashed: data.members.findIndex((c) => c.id === m.id) >= tones.length,
            }))}
            formatTick={format}
            ariaLabel={chartName}
            tooltip={(i) => (
              <div className="space-y-1">
                <p>{t("observationTurn", { turn: history.consecutive[i].turn })}</p>
                {selected.map((m, j) => (
                  <p key={m.id}>
                    {m.name}: {format(history.consecutive[i].values[j])}
                  </p>
                ))}
              </div>
            )}
          />
        ) : (
          <p className="flex min-h-40 items-center justify-center text-sm text-muted">
            {selected.length ? t("comparisonHistoryUnavailable") : t("noComparisonMembers")}
          </p>
        )}
        <p className="text-xs text-muted">
          {t("comparisonHistoryNote", { count: history.all.length, range })}
        </p>
        <details>
          <summary className="cursor-pointer text-xs text-info">{t("viewComparisonData")}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="text-xs">
              <caption className="sr-only">{t("comparisonHistoryTable")}</caption>
              <thead>
                <tr>
                  <th>{t("turnLabel")}</th>
                  {selected.map((m) => (
                    <th key={m.id}>{m.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.all.map((p) => (
                  <tr key={p.turn}>
                    <td>{p.turn}</td>
                    {p.values.map((v, i) => (
                      <td key={selected[i].id}>{format(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
