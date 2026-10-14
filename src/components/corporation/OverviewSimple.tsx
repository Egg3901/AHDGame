"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { MONEY_PERIOD_SUFFIX, type MoneyPeriod } from "@/lib/constants/moneyTimescale";
import {
  DenseSection,
  FillText,
  KVList,
  KVRow,
  SmallButton,
  TableScroll,
  Td,
  Th,
  signTone,
} from "./dense/DenseKit";
import {
  DataBar,
  Delta,
  DivergingBar,
  Meter,
  TEXT_TONE,
  gradeTone,
  toneOfSign,
  type Tone,
} from "./dense/InlineViz";
import { sectorMargin, sectorRevenue, type AttentionItem } from "./overviewModel";
import type { CorpTabId, SectorDetail } from "./CorporationPageTypes";

const TOP_SECTORS = 5;

const ATTENTION_RULE: Record<AttentionItem["tone"], string> = {
  error: "border-l-error from-error/10",
  warning: "border-l-warning from-warning/10",
  primary: "border-l-primary from-primary/10",
};

const ATTENTION_DOT: Record<AttentionItem["tone"], string> = {
  error: "bg-error",
  warning: "bg-warning",
  primary: "bg-primary",
};

export interface SimpleFigures {
  revenue: string | null;
  netIncome: { text: string; raw: number } | null;
  netMargin: number | null;
  growth: { value: number; label: string; unit: string } | null;
  cash: { text: string; raw: number } | null;
  cashTone?: Tone;
  debt: { text: string; rating: string | null; bonds: number } | null;
  sharePrice: string | null;
  marketCap: string | null;
  fillPct: number | null;
}

/**
 * The Simple layout of the corporation Overview: what needs the reader, the
 * handful of figures that say how the company is doing, and its biggest
 * sectors. Everything else stays one toggle away in Pro.
 */
export function OverviewSimple({
  attention,
  figures,
  sectors,
  corpId,
  periodView,
  periodControl,
  fogged,
  fmt,
  plantsMode,
  scale,
  onTabChange,
  aside,
}: {
  attention: AttentionItem[];
  figures: SimpleFigures;
  sectors: SectorDetail[];
  corpId: string;
  periodView: MoneyPeriod;
  periodControl: ReactNode;
  fogged: boolean;
  fmt: (local: number) => string;
  plantsMode: boolean;
  scale: (daily: number) => number;
  onTabChange: (tab: CorpTabId) => void;
  aside?: ReactNode;
}) {
  const suffix = MONEY_PERIOD_SUFFIX[periodView];
  const est = (text: string) => (fogged ? `~${text}` : text);
  const top = [...sectors]
    .sort((a, b) => sectorRevenue(b) - sectorRevenue(a))
    .slice(0, TOP_SECTORS);
  const maxRevenue = Math.max(0, ...top.map((s) => sectorRevenue(s) ?? 0));
  const hasMoney = sectors.some((s) => typeof s.revenue === "number");

  return (
    <div className={`grid gap-x-8 gap-y-6 ${aside ? "lg:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
      <div className="min-w-0 space-y-6">
        {/* Without a side column the page is wide enough to read what needs
            attention beside the figures, so both sit above the fold. */}
        <div className={aside ? "space-y-6" : "grid gap-x-8 gap-y-6 lg:grid-cols-2"}>
          <DenseSection
            title="Needs attention"
            meta={attention.length > 0 ? `${attention.length}` : undefined}
          >
            {attention.length === 0 ? (
              <p className="-ml-2 flex items-center gap-2 border-l-2 border-l-success bg-gradient-to-r from-success/10 to-transparent py-2 pl-2 text-[13px] text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                Nothing needs you right now.
              </p>
            ) : (
              <ul>
                {attention.map((item) => (
                  <li
                    key={item.key}
                    className={`-ml-2 flex items-center justify-between gap-3 border-b border-l-2 border-b-card-border/60 bg-gradient-to-r to-transparent py-1.5 pl-2 last:border-b-0 ${ATTENTION_RULE[item.tone]}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${ATTENTION_DOT[item.tone]}`}
                        />
                        <span className="truncate">{item.title}</span>
                      </div>
                      {item.detail && (
                        <div className="truncate pl-3.5 text-xs text-muted">{item.detail}</div>
                      )}
                    </div>
                    {item.tab && (
                      <SmallButton onClick={() => onTabChange(item.tab as CorpTabId)}>
                        Open
                      </SmallButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DenseSection>

          <DenseSection
            title="At a glance"
            meta={fogged ? "~ estimated from the last quarterly report" : undefined}
            actions={periodControl}
          >
            <div className="grid gap-x-8 sm:grid-cols-2">
              <KVList>
                {figures.revenue != null && (
                  <KVRow lead label={`Revenue${suffix}`} value={est(figures.revenue)} />
                )}
                {figures.netIncome && (
                  <KVRow
                    lead
                    accent={toneOfSign(figures.netIncome.raw)}
                    label={`Net income${suffix}`}
                    value={
                      <span className={signTone(figures.netIncome.raw)}>
                        {est(figures.netIncome.text)}
                      </span>
                    }
                  />
                )}
                {figures.netMargin != null && (
                  <KVRow
                    label="Net margin"
                    mark={<DivergingBar value={figures.netMargin} />}
                    value={
                      <span className={signTone(figures.netMargin)}>
                        {figures.netMargin.toFixed(1)}%
                      </span>
                    }
                  />
                )}
                {figures.growth && (
                  <KVRow
                    label={figures.growth.label}
                    value={<Delta value={figures.growth.value} />}
                    hint={figures.growth.unit}
                  />
                )}
              </KVList>
              <KVList>
                {figures.cash && (
                  <KVRow
                    lead
                    accent={figures.cashTone}
                    label="Cash"
                    value={
                      <span className={figures.cash.raw < 0 ? "text-error" : undefined}>
                        {est(figures.cash.text)}
                      </span>
                    }
                  />
                )}
                {figures.debt && (
                  <KVRow
                    label="Debt"
                    value={figures.debt.text}
                    hint={
                      figures.debt.rating ? (
                        <span
                          className={`font-semibold ${TEXT_TONE[gradeTone(figures.debt.rating)]}`}
                        >
                          {figures.debt.rating}
                        </span>
                      ) : undefined
                    }
                  />
                )}
                {figures.sharePrice != null && (
                  <KVRow
                    label="Share price"
                    value={figures.sharePrice}
                    hint={figures.marketCap ?? undefined}
                  />
                )}
                {figures.fillPct != null && (
                  <KVRow
                    label="Output sold"
                    title="Share of what the plants produced that buyers took last turn."
                    mark={<Meter pct={figures.fillPct} />}
                    value={`${Math.round(figures.fillPct)}%`}
                  />
                )}
              </KVList>
            </div>
          </DenseSection>
        </div>

        <DenseSection
          title="Biggest sectors"
          meta={
            sectors.length > TOP_SECTORS ? `top ${TOP_SECTORS} of ${sectors.length}` : undefined
          }
          actions={<SmallButton onClick={() => onTabChange("sectors")}>All sectors</SmallButton>}
        >
          {top.length === 0 ? (
            <p className="py-2 text-xs text-muted">No sectors yet.</p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[420px] border-collapse">
                <thead>
                  <tr className="bg-card-border/15">
                    <Th>Sector</Th>
                    {hasMoney && <Th align="right">Revenue{suffix}</Th>}
                    <Th align="right">Margin</Th>
                    <Th align="right">{plantsMode ? "Fill" : "Share"}</Th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((s) => {
                    const flag = STATE_FLAGS[s.stateId];
                    const margin = sectorMargin(s);
                    const revenue = sectorRevenue(s);
                    return (
                      <tr key={s._id} className="hover:bg-card-elevated/40">
                        <Td
                          className={`border-l-2 ${
                            typeof s.profit === "number" && s.profit < 0
                              ? "border-l-error/70"
                              : "border-l-transparent"
                          }`}
                        >
                          <Link
                            href={`/corporation/${corpId}/sector/${s._id}`}
                            className="inline-flex max-w-[16rem] items-center gap-1.5 truncate text-foreground hover:underline"
                          >
                            {flag && (
                              <Image
                                src={flag}
                                alt=""
                                width={16}
                                height={11}
                                className="h-[11px] w-4 shrink-0 rounded-[2px] object-cover"
                                unoptimized={bypassNextImageOptimization(flag)}
                              />
                            )}
                            <span className="truncate">{s.displayName ?? s.stateName}</span>
                            <span className="truncate text-muted">{s.sectorLabel}</span>
                          </Link>
                          {s.embargoSuspended && (
                            <span
                              className="ml-1.5 text-[11px] text-error"
                              title="Suspended by embargo"
                            >
                              embargo
                            </span>
                          )}
                        </Td>
                        {hasMoney && (
                          <Td align="right">
                            {typeof s.revenue === "number" ? est(fmt(scale(revenue))) : "n/a"}
                            <DataBar
                              value={revenue}
                              max={maxRevenue}
                              className="ml-auto mt-0.5 w-20"
                            />
                          </Td>
                        )}
                        <Td align="right" className={signTone(margin)}>
                          <span className="inline-flex items-center gap-2">
                            <DivergingBar value={margin} className="hidden w-10 sm:inline-block" />
                            {margin != null ? `${margin.toFixed(1)}%` : "n/a"}
                          </span>
                        </Td>
                        <Td align="right" className={plantsMode ? undefined : "text-muted"}>
                          {plantsMode ? (
                            <FillText fill={s.fillRate} band={s.fillRateBand} />
                          ) : typeof s.marketSharePercent === "number" ? (
                            `${s.marketSharePercent.toFixed(1)}%`
                          ) : (
                            "n/a"
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
          {/* Profit is the one figure Simple leaves to the colour rule on the
              left edge; Pro carries the full column. */}
          {hasMoney && top.some((s) => typeof s.profit === "number" && s.profit < 0) && (
            <p className="pt-1.5 text-[11px] text-muted">
              <span aria-hidden className="mr-1 inline-block h-2 w-0.5 bg-error/70 align-middle" />
              Red edge: the sector is losing money.
            </p>
          )}
        </DenseSection>
      </div>
      {aside && <aside className="min-w-0 space-y-6">{aside}</aside>}
    </div>
  );
}
