"use client";
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Compass, Network } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CorporationLogo } from "../CorporationLogo";
import { DenseLineChart } from "../dense/DenseLineChart";
import { groupOverviewHistory } from "@/lib/corporations/groups/rules/overview";
import type { GroupBalanceSheet } from "@/lib/corporations/groups/groupBalanceSheet";
import type { GroupManagementView } from "./useGroupManagement";
import styles from "./GroupPage.module.css";
const colors = ["var(--gold)", "var(--info)", "var(--secondary)", "var(--success)"];
const link =
  "inline-flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium hover:bg-card-elevated";
export function GroupOverviewDashboard({
  data,
  sheet,
}: {
  data: GroupManagementView;
  sheet: GroupBalanceSheet | null;
}) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const [lookback, setLookback] = useState<12 | 24 | 48>(24);
  const overview = groupOverviewHistory(
    data.members.map((m) => m.history),
    data.currentTurn,
    lookback
  );
  // Do not combine a stale structure response with a newly resolved member set.
  const structure =
    sheet &&
    sheet.members.length === data.members.length &&
    data.members.every((m) => sheet.members.some((s) => s.corporationId === m.id))
      ? sheet
      : null;
  const current = overview.latest;
  const contributions = overview.contributions;
  const unknown = t("unavailable");
  const metrics = [
    {
      label: t("overviewRevenue"),
      value: current ? formatAmount(current.revenue) : unknown,
      note: t("perTurnRevenue"),
    },
    {
      label: t("overviewIncome"),
      value: current ? formatAmount(current.income) : unknown,
      note:
        overview.margin == null
          ? t("marginUnavailable")
          : t("combinedMargin", { percent: Number(overview.margin.toFixed(1)) }),
    },
    {
      label: t("overviewCash"),
      value: structure ? formatAmount(structure.totalLiquidCapitalAnchor) : unknown,
      note: t("separateCash"),
    },
    {
      label: t("footprint"),
      value: structure ? t("sectorCount", { count: structure.totalSectorCount }) : unknown,
      note:
        structure && Number.isFinite(structure.totalRegionCount)
          ? t("regionCount", { count: structure.totalRegionCount })
          : unknown,
    },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>
          {current ? t("completedTurn", { turn: current.turn }) : t("completeHistoryUnavailable")}
        </p>
        <a className={link} href="#financials">
          {t("compareCorporations")} <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0 border-l-2 border-card-border pl-4">
            <dt className="text-xs text-muted">{m.label}</dt>
            <dd className="mt-1 break-words font-mono text-2xl font-semibold tabular-nums">
              {m.value}
            </dd>
            <p className="mt-1 text-xs text-muted">{m.note}</p>
          </div>
        ))}
      </dl>
      <div>
        <h2 className="text-lg font-semibold">{t("atGlance")}</h2>
        <p className="mt-1 text-xs text-muted">{t("overviewBasis")}</p>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-card-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">{t("revenueTrend")}</h3>
            <div
              className="inline-flex rounded-lg border border-card-border p-1"
              role="group"
              aria-label={t("trendRange")}
            >
              {([12, 24, 48] as const).map((turns) => (
                <button
                  key={turns}
                  type="button"
                  aria-pressed={lookback === turns}
                  onClick={() => setLookback(turns)}
                  className={`rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-info ${lookback === turns ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  {t("turnRange", { count: turns })}
                </button>
              ))}
            </div>
          </div>
          {overview.consecutive.length >= 2 ? (
            <DenseLineChart
              turns={overview.consecutive.map((p) => p.turn)}
              series={[
                {
                  label: t("combinedRevenue"),
                  values: overview.consecutive.map((p) => p.revenue),
                  tone: "text-gold",
                },
              ]}
              formatTick={formatAmount}
              ariaLabel={t("revenueTrend")}
              tooltip={(i) => (
                <span>
                  {t("observationTurn", { turn: overview.consecutive[i].turn })}:{" "}
                  {formatAmount(overview.consecutive[i].revenue)}
                </span>
              )}
            />
          ) : (
            <p className="flex min-h-48 items-center justify-center text-sm text-muted">
              {t("trendUnavailable")}
            </p>
          )}
          <p className="text-xs text-muted">
            {t("trendCoverage", { count: overview.points.length, range: lookback })}
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-info">{t("viewTrendData")}</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="text-sm">
                <caption className="sr-only">{t("revenueTrend")}</caption>
                <thead>
                  <tr>
                    <th>{t("turnLabel")}</th>
                    <th>{t("turnRevenue")}</th>
                    <th>{t("turnIncome")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.points.map((p) => (
                    <tr key={p.turn}>
                      <td>{p.turn}</td>
                      <td>{formatAmount(p.revenue)}</td>
                      <td>{formatAmount(p.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="min-w-0 rounded-xl border border-card-border bg-card p-5 space-y-4">
          <h3 className="font-semibold">{t("revenueContribution")}</h3>
          {contributions ? (
            data.members.map((m, i) => (
              <div key={m.id} className="space-y-2">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="min-w-0 break-words">{m.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {t("percentage", { percent: Number(contributions![i].toFixed(1)) })}
                  </span>
                </div>
                <meter
                  className={styles.contribution}
                  style={{ "--member-color": colors[i % colors.length] } as CSSProperties}
                  min={0}
                  max={100}
                  value={contributions[i]}
                  aria-label={m.name}
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">{t("contributionUnavailable")}</p>
          )}
          <p className="text-xs text-muted">{t("combinedOverviewNote")}</p>
        </section>
      </div>
      <div>
        <h2 className="text-lg font-semibold">{t("distinctBusinesses")}</h2>
        <p className="mt-1 text-xs text-muted">{t("separateBusinesses")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.members.map((m, i) => {
          const member = structure?.members.find((s) => s.corporationId === m.id);
          const snapshot = current
            ? m.history?.find((h) => h.turn === current.turn)
            : m.history?.[0];
          const parent =
            m.parentControl && data.members.find((c) => c.id === m.parentControl!.corporationId);
          return (
            <article
              key={m.id}
              className="min-w-0 rounded-xl border border-card-border border-t-2 bg-card p-4 space-y-4"
              style={{ borderTopColor: colors[i % colors.length] }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted">
                  {m.tickerSymbol ??
                    member?.tickerSymbol ??
                    t(m.isRoot ? "parentLabel" : "subsidiaryLabel")}
                </span>
                <span className="rounded border border-card-border px-2 py-1 text-[10px] text-muted">
                  {t(m.operator === "npp" ? "npp" : "player")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <CorporationLogo logoUrl={m.logoUrl} name={m.name} />
                <h3 className="min-w-0 break-words font-semibold">{m.name}</h3>
              </div>
              {m.isRoot ? (
                <p className="text-xs text-muted">{t("parentCorporation")}</p>
              ) : (
                parent && (
                  <p className="text-xs text-muted">
                    {t("parentVotingControl", {
                      parent: parent.name,
                      percent: m.parentControl!.votingPercent,
                    })}
                  </p>
                )
              )}
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2 border-b border-card-border pb-2">
                  <dt className="text-muted">{t("turnRevenue")}</dt>
                  <dd className="font-mono tabular-nums">
                    {snapshot
                      ? formatAmount(snapshot.revenue)
                      : m.history === null
                        ? t("privateFinancial")
                        : unknown}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-card-border pb-2">
                  <dt className="text-muted">{t("turnIncome")}</dt>
                  <dd
                    className={`font-mono tabular-nums ${snapshot && snapshot.income < 0 ? "text-error" : snapshot && snapshot.income > 0 ? "text-success" : ""}`}
                  >
                    {snapshot
                      ? formatAmount(snapshot.income)
                      : m.history === null
                        ? t("privateFinancial")
                        : unknown}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted">{t("footprint")}</dt>
                  <dd>
                    {member && Number.isFinite(member.regionCount)
                      ? t("memberFootprint", {
                          sectors: member.sectorCount,
                          regions: member.regionCount,
                        })
                      : unknown}
                  </dd>
                </div>
              </dl>
              {snapshot && (
                <p className="text-[10px] text-muted">
                  {t("observationTurn", { turn: snapshot.turn })}
                </p>
              )}
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
                href={"/corporation/" + m.pathId}
              >
                {t("viewCorporation")}
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </article>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href="#directions"
          className="flex items-start gap-3 rounded-lg border border-gold/30 bg-gold/5 p-4"
        >
          <Compass size={18} className="shrink-0 text-gold" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{t("directionWithoutMicromanagement")}</p>
            <p className="mt-1 text-xs text-muted">{t("directionNote")}</p>
          </div>
        </a>
        <a
          href="#supply"
          className="flex items-start gap-3 rounded-lg border border-info/30 bg-info/5 p-4"
        >
          <Network size={18} className="shrink-0 text-info" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{t("supplyTitle")}</p>
            <p className="mt-1 text-xs text-muted">{t("policies." + data.settings.supplyPolicy)}</p>
          </div>
        </a>
      </div>
    </div>
  );
}
