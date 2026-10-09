"use client";

import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  MONEY_PERIODS,
  MONEY_PERIOD_LABEL,
  MONEY_PERIOD_SUFFIX,
  scaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { formatEffectiveCouponPct, formatMarketingStrength } from "@/lib/utils/formatters";
import { loyaltyLabel } from "@/lib/market/brandLoyalty";
import { CorpEconomicModelBadge } from "@/components/economy/CorpEconomicModelBadge";
import { GameMonthTime } from "@/components/time/GameMonthTime";
import { fetchJson } from "@/lib/observability/fetchJson";
import { corpIncomeBasis, netMarginPct } from "./financials/financialsModel";
import { OwnershipDonut, buildOwnershipSlices } from "./OwnershipDonut";
import { CAPACITY_UNIT_LABEL, formatUnits } from "./plantsPresentation";
import {
  DenseSection,
  FillText,
  KVList,
  KVRow,
  Segmented,
  SmallButton,
  TableScroll,
  Td,
  Th,
  signTone,
  useCorpMoney,
} from "./dense/DenseKit";
import type {
  BalanceSheet,
  BondInfo,
  CorpTabId,
  CorporationDetail,
  FinancialFogMeta,
  Financials,
  SectorDetail,
} from "./CorporationPageTypes";

interface OverviewTabProps {
  corporation: CorporationDetail;
  /** Null for a private corporation viewed by an outsider (books redacted). */
  financials: Financials | null;
  balanceSheet: BalanceSheet | null;
  bondInfo: BondInfo | null;
  sectors: SectorDetail[];
  corpId: string;
  periodView: MoneyPeriod;
  onPeriodViewChange: (period: MoneyPeriod) => void;
  onTabChange: (tab: CorpTabId) => void;
  financialFogOfWar?: FinancialFogMeta | null;
  isCeo: boolean;
  myCharacterId: string | null;
  /** Opens the trade ticket; omitted when the viewer cannot trade here. */
  onTrade?: () => void;
}

const PERIOD_OPTIONS = MONEY_PERIODS.map((p) => ({ value: p, label: MONEY_PERIOD_LABEL[p] }));

/**
 * A headline figure in a tinted box, so the four numbers most players want
 * read at a glance before the full statement below.
 */
function StatTile({
  label,
  value,
  sub,
  tone = "text-foreground",
  meter,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  /** Percentage drawn as a bar under the value, clamped to 0..100. */
  meter?: number;
}) {
  return (
    <div className="min-w-0 rounded-md border border-card-border bg-card-border/15 px-3 py-2">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`truncate font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {meter != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-card-border/50">
          <div
            className={`h-full rounded-full ${meter >= 0 ? "bg-success" : "bg-error"}`}
            style={{ width: `${Math.min(100, Math.abs(meter))}%` }}
          />
        </div>
      )}
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Links styled as quiet inline actions inside a table or list row. */
function RowLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-xs text-muted underline decoration-card-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
    >
      {children}
    </button>
  );
}

type SectorSortKey = "revenue" | "margin" | "profit" | "share" | "workers";

function sectorRevenue(s: SectorDetail): number {
  return s.financialRevenue ?? s.revenue;
}

function sectorMargin(s: SectorDetail): number | null {
  const m = s.fillAdjustedMarginPct ?? s.effectiveProfitMargin;
  return typeof m === "number" && Number.isFinite(m) ? m : null;
}

const SORT_VALUE: Record<SectorSortKey, (s: SectorDetail) => number> = {
  revenue: (s) => sectorRevenue(s) ?? -Infinity,
  margin: (s) => sectorMargin(s) ?? -Infinity,
  profit: (s) => s.profit ?? -Infinity,
  share: (s) => s.marketSharePercent ?? -Infinity,
  workers: (s) => s.workers ?? -Infinity,
};

const SECTOR_ROWS_COLLAPSED = 10;

function SectorTable({
  sectors,
  corpId,
  periodView,
  plantsMode,
  fogged,
  fmt,
  fmtSigned,
}: {
  sectors: SectorDetail[];
  corpId: string;
  periodView: MoneyPeriod;
  plantsMode: boolean;
  fogged: boolean;
  fmt: (local: number) => string;
  fmtSigned: (local: number) => string;
}) {
  const [sortKey, setSortKey] = useState<SectorSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const value = SORT_VALUE[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...sectors].sort((a, b) => (value(a) - value(b)) * dir);
  }, [sectors, sortKey, sortDir]);
  const visible = expanded ? sorted : sorted.slice(0, SECTOR_ROWS_COLLAPSED);

  const sortBy = (key: SectorSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const sortState = (key: SectorSortKey) => (key === sortKey ? sortDir : null);

  // Redacted rows (private corp, outsider) carry no revenue; hide money columns
  // rather than print a column of dashes.
  const hasMoney = sectors.some((s) => typeof s.revenue === "number");
  const scale = (daily: number) => Math.round(scaleMoney(daily, periodView));
  const totals = sectors.reduce(
    (acc, s) => ({
      revenue: acc.revenue + (sectorRevenue(s) ?? 0),
      profit: acc.profit + (s.profit ?? 0),
      workers: acc.workers + (s.workers ?? 0),
    }),
    { revenue: 0, profit: 0, workers: 0 }
  );
  const est = (text: string) => (fogged ? `~${text}` : text);

  return (
    <>
      <TableScroll>
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <Th>Region</Th>
              <Th>Sector</Th>
              {hasMoney && (
                <Th align="right" onClick={() => sortBy("revenue")} sorted={sortState("revenue")}>
                  Revenue{MONEY_PERIOD_SUFFIX[periodView]}
                </Th>
              )}
              <Th
                align="right"
                onClick={() => sortBy("margin")}
                sorted={sortState("margin")}
                title="Profit over the full cost bill where plants report it, else the operating margin."
              >
                Margin
              </Th>
              <Th align="right" onClick={() => sortBy("profit")} sorted={sortState("profit")}>
                Profit{MONEY_PERIOD_SUFFIX[periodView]}
              </Th>
              <Th
                align="right"
                onClick={() => sortBy("share")}
                sorted={sortState("share")}
                title="Share of this sector's market in the region."
              >
                Share
              </Th>
              {hasMoney && (
                <Th
                  align="right"
                  onClick={() => sortBy("workers")}
                  sorted={sortState("workers")}
                  className="hidden sm:table-cell"
                >
                  Workers
                </Th>
              )}
              {plantsMode ? (
                <>
                  <Th align="right" className="hidden md:table-cell">
                    Capacity
                  </Th>
                  <Th align="right">Fill</Th>
                </>
              ) : (
                <Th align="right" title="Revenue growth rate per turn.">
                  Growth
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const flag = STATE_FLAGS[s.stateId];
              const margin = sectorMargin(s);
              return (
                <tr key={s._id} className="hover:bg-card-elevated/40">
                  <Td>
                    <Link
                      href={`/corporation/${corpId}/sector/${s._id}`}
                      className="inline-flex max-w-[14rem] items-center gap-1.5 truncate text-foreground hover:underline"
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
                    </Link>
                    {s.embargoSuspended && (
                      <span className="ml-1.5 text-[11px] text-error" title="Suspended by embargo">
                        embargo
                      </span>
                    )}
                    {s.mothballed && (
                      <span className="ml-1.5 text-[11px] text-muted" title="Mothballed">
                        mothballed
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted">{s.sectorLabel}</Td>
                  {hasMoney && (
                    <Td align="right">
                      {typeof s.revenue === "number" ? est(fmt(scale(sectorRevenue(s)))) : "n/a"}
                    </Td>
                  )}
                  <Td align="right" className={signTone(margin)}>
                    {margin != null ? `${margin.toFixed(1)}%` : "n/a"}
                  </Td>
                  <Td align="right" className={signTone(s.profit)}>
                    {typeof s.profit === "number" ? est(fmtSigned(scale(s.profit))) : "n/a"}
                  </Td>
                  <Td align="right" className="text-muted">
                    {typeof s.marketSharePercent === "number"
                      ? `${s.marketSharePercent.toFixed(1)}%`
                      : "n/a"}
                  </Td>
                  {hasMoney && (
                    <Td align="right" className="hidden text-muted sm:table-cell">
                      {typeof s.workers === "number" ? s.workers.toLocaleString("en-US") : "n/a"}
                    </Td>
                  )}
                  {plantsMode ? (
                    <>
                      <Td align="right" className="hidden text-muted md:table-cell">
                        {formatUnits(s.capacityUnits)}
                      </Td>
                      <Td align="right">
                        <FillText fill={s.fillRate} band={s.fillRateBand} />
                      </Td>
                    </>
                  ) : (
                    <Td align="right" className="text-muted">
                      {Number.isFinite(s.currentGrowthRate) ? `${s.currentGrowthRate}%` : "n/a"}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {hasMoney && sectors.length > 1 && (
            <tfoot>
              <tr className="font-medium">
                <Td className="text-muted">Total</Td>
                <Td className="text-muted">{sectors.length} sectors</Td>
                <Td align="right">{est(fmt(scale(totals.revenue)))}</Td>
                <Td align="right" className={signTone(totals.revenue ? totals.profit : null)}>
                  {totals.revenue > 0
                    ? `${((totals.profit / totals.revenue) * 100).toFixed(1)}%`
                    : "n/a"}
                </Td>
                <Td align="right" className={signTone(totals.profit)}>
                  {est(fmtSigned(scale(totals.profit)))}
                </Td>
                <Td />
                <Td align="right" className="hidden sm:table-cell">
                  {totals.workers.toLocaleString("en-US")}
                </Td>
                {plantsMode ? (
                  <>
                    <Td className="hidden md:table-cell" />
                    <Td />
                  </>
                ) : (
                  <Td />
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </TableScroll>
      {sectors.length > SECTOR_ROWS_COLLAPSED && (
        <div className="pt-2">
          <SmallButton onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${sectors.length}`}
          </SmallButton>
        </div>
      )}
    </>
  );
}

interface OpenVote {
  _id: string;
  type: string;
  deadlineAtTurn?: number;
  payload?: Record<string, unknown>;
}

const VOTE_LABEL: Record<string, string> = {
  governance_change: "Restructuring",
  dissolution: "Dissolution",
  relocation: "Relocation",
  share_issuance: "Share issuance",
  adopt_supershares: "Supershares",
  ticker_change: "Ticker change",
};

/**
 * Signed per-turn change for an operations metric. Absent when the route
 * redacts a private corporation's books for an outside viewer, which is
 * unknown rather than zero, so no hint is shown.
 */
function perTurnChangeHint(change: number | undefined) {
  if (change == null || !Number.isFinite(change)) return undefined;
  return (
    <span className={signTone(change)}>
      {change >= 0 ? "+" : ""}
      {change.toFixed(2)}
    </span>
  );
}

export default function OverviewTab({
  corporation,
  financials,
  balanceSheet,
  bondInfo,
  sectors,
  corpId,
  periodView,
  onPeriodViewChange,
  onTabChange,
  financialFogOfWar,
  isCeo,
  myCharacterId,
  onTrade,
}: OverviewTabProps) {
  const money = useCorpMoney(corporation.liquidCurrencyCode);
  const { fmt, fmtSigned, fmtPrice } = money;
  const fogged = financialFogOfWar != null;
  const est = (text: string) => (fogged ? `~${text}` : text);
  const scale = (daily: number) => Math.round(scaleMoney(daily, periodView));
  const suffix = MONEY_PERIOD_SUFFIX[periodView];

  const [openVotes, setOpenVotes] = useState<OpenVote[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchJson<unknown>(
      `/api/corporations/${corporation.sequentialId ?? corporation._id}/votes?status=open`,
      { feature: "corp-open-votes" }
    )
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setOpenVotes(data as OpenVote[]);
      })
      // fetchJson has already reported the failure; the list just stays empty.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [corporation._id, corporation.sequentialId]);

  const basis = financials ? corpIncomeBasis(financials) : null;
  const netMargin = financials ? netMarginPct(financials) : null;
  const stateCount = new Set(sectors.map((s) => s.stateId)).size;
  const floatPct =
    corporation.totalShares > 0 ? (corporation.publicFloat / corporation.totalShares) * 100 : null;
  const bookValue = balanceSheet?.equity.bookValue ?? null;
  const priceToBook =
    bookValue != null && bookValue > 0 ? corporation.marketCapitalization / bookValue : null;
  const activeBonds = bondInfo?.bonds.filter((b) => !b.defaulted && !b.matured).length ?? 0;

  const myHolding = myCharacterId
    ? corporation.shareholders.find((sh) => sh.characterId === myCharacterId)
    : undefined;
  const myShares = myHolding?.shares ?? 0;
  const canSeeMarket = !corporation.isPrivate || isCeo;

  // Same destinations as the full shareholder register on the Shares tab.
  const holderHref = (sh: CorporationDetail["shareholders"][number]) =>
    sh.corporationId
      ? `/corporation/${sh.sequentialId ?? sh.corporationId}`
      : sh.isFund && sh.fundSlug
        ? sh.fundScope === "country" && sh.fundCountryId
          ? `/stockmarket/${sh.fundCountryId.toLowerCase()}/fund/${sh.fundSlug}`
          : `/stockmarket/global/fund/${sh.fundSlug}`
        : sh.isNpp || sh.isFund
          ? null
          : `/character/${sh.sequentialId ?? sh.characterId}`;
  const ownershipSlices = buildOwnershipSlices(corporation, holderHref, myCharacterId);

  const brand =
    corporation.brandLoyaltyLabel ??
    (corporation.brandLoyalty != null ? loyaltyLabel(corporation.brandLoyalty) : undefined);
  const physical = corporation.physical ?? null;

  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        {financials && (
          <DenseSection
            title="Key statistics"
            meta={fogged ? "~ estimated from the last quarterly report" : undefined}
            actions={
              <Segmented
                ariaLabel="Money period"
                options={PERIOD_OPTIONS}
                value={periodView}
                onChange={onPeriodViewChange}
              />
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile
                label={`Revenue${suffix}`}
                value={est(fmt(scale(financials.totalRevenue)))}
              />
              {basis && (
                <StatTile
                  label={`Net income${suffix}`}
                  value={est(fmtSigned(scale(basis.netIncome)))}
                  tone={signTone(basis.netIncome)}
                />
              )}
              {netMargin != null && (
                <StatTile
                  label="Net margin"
                  value={`${netMargin.toFixed(1)}%`}
                  tone={signTone(netMargin)}
                  meter={netMargin}
                />
              )}
              <StatTile
                label={financials.growthRateIsRealized ? "Revenue growth" : "Growth rate"}
                value={`${financials.currentGrowthRate >= 0 ? "▲" : "▼"} ${Math.abs(
                  financials.currentGrowthRate
                ).toFixed(1)}%`}
                sub={financials.growthRateIsRealized ? "past year" : "per turn"}
                tone={signTone(financials.currentGrowthRate)}
              />
            </div>
            <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
              <KVList>
                {canSeeMarket && (
                  <KVRow
                    label="Share price"
                    value={fmtPrice(corporation.sharePrice)}
                    action={onTrade ? <RowLink onClick={onTrade}>Trade</RowLink> : undefined}
                  />
                )}
                {canSeeMarket &&
                  corporation.equityMarketPoolActive &&
                  Number.isFinite(corporation.marketBidPrice) &&
                  Number.isFinite(corporation.marketAskPrice) && (
                    <KVRow
                      label="Bid / ask"
                      value={`${fmtPrice(corporation.marketBidPrice as number)} / ${fmtPrice(corporation.marketAskPrice as number)}`}
                    />
                  )}
                {canSeeMarket && (
                  <KVRow label="Market cap" value={fmt(corporation.marketCapitalization)} />
                )}
                {bookValue != null && (
                  <KVRow
                    label="Book value"
                    value={est(fmt(bookValue))}
                    hint={priceToBook != null ? `P/B ${priceToBook.toFixed(2)}` : undefined}
                    title="Market cap can fall through a debt-funded build-out: the bond lands on the book at once, the new capacity only adds value as it starts earning."
                  />
                )}
                <KVRow
                  label="Shares outstanding"
                  value={corporation.totalShares.toLocaleString("en-US")}
                />
                {!corporation.isPrivate && floatPct != null && (
                  <KVRow
                    label="Public float"
                    value={`${floatPct.toFixed(1)}%`}
                    hint={corporation.publicFloat.toLocaleString("en-US")}
                  />
                )}
                <KVRow
                  label="Dividend"
                  value={
                    financials.effectiveDividendRate > 0
                      ? `${financials.effectiveDividendRate}%`
                      : "None"
                  }
                  hint={
                    financials.effectiveDividendRate > (corporation.dividendRate ?? 0)
                      ? "legal floor"
                      : undefined
                  }
                  action={
                    isCeo ? <RowLink onClick={() => onTabChange("ceo")}>Set</RowLink> : undefined
                  }
                />
              </KVList>

              <KVList>
                <KVRow
                  label={`Revenue${suffix}`}
                  value={est(fmt(scale(financials.totalRevenue)))}
                />
                <KVRow
                  label={`Operating income${suffix}`}
                  value={
                    <span className={signTone(financials.operatingIncome)}>
                      {est(fmtSigned(scale(financials.operatingIncome)))}
                    </span>
                  }
                />
                {basis && (
                  <KVRow
                    label={`Net income${suffix}`}
                    value={
                      <span className={signTone(basis.netIncome)}>
                        {est(fmtSigned(scale(basis.netIncome)))}
                      </span>
                    }
                    hint={basis.isRealized ? undefined : "projected"}
                  />
                )}
                {basis && basis.dividendPaid > 0 && (
                  <KVRow
                    label={`Dividends paid${suffix}`}
                    value={est(fmt(scale(basis.dividendPaid)))}
                  />
                )}
                {basis && (
                  <KVRow
                    label={`Retained${suffix}`}
                    value={
                      <span className={signTone(basis.retained)}>
                        {est(fmtSigned(scale(basis.retained)))}
                      </span>
                    }
                  />
                )}
                {netMargin != null && (
                  <KVRow
                    label="Net margin"
                    value={<span className={signTone(netMargin)}>{netMargin.toFixed(1)}%</span>}
                  />
                )}
                <KVRow
                  label={financials.growthRateIsRealized ? "Revenue growth" : "Growth rate"}
                  value={`${financials.currentGrowthRate.toFixed(2)}%${
                    financials.growthRateIsRealized ? "/yr" : "/turn"
                  }`}
                />
              </KVList>

              <KVList>
                <KVRow
                  label="Cash"
                  value={est(fmt(corporation.liquidCapital))}
                  title={money.fmtFull(corporation.liquidCapital)}
                />
                {(corporation.shareEscrowBalance ?? 0) !== 0 && (
                  <KVRow
                    label="Buyback escrow"
                    value={fmt(corporation.shareEscrowBalance ?? 0)}
                    title="Held to fund share sell-backs; not spendable as cash."
                  />
                )}
                {balanceSheet && (
                  <KVRow label="Total assets" value={est(fmt(balanceSheet.assets.totalAssets))} />
                )}
                {bondInfo ? (
                  <>
                    <KVRow
                      label="Total debt"
                      value={fmt(bondInfo.totalDebt)}
                      hint={
                        activeBonds > 0
                          ? `${activeBonds} bond${activeBonds === 1 ? "" : "s"}`
                          : undefined
                      }
                      action={
                        isCeo ? (
                          <RowLink onClick={() => onTabChange("credit")}>Issue</RowLink>
                        ) : undefined
                      }
                    />
                    <KVRow
                      label="Leverage rating"
                      title="Measures debt load and the ability to service it, not profitability: a company with no debt rates AAA."
                      value={corporation.creditRatingSnapshot ?? bondInfo.creditRating.rating}
                      hint={`${corporation.creditCompositeSnapshot ?? bondInfo.creditRating.compositeScore}/100`}
                      action={<RowLink onClick={() => onTabChange("credit")}>Details</RowLink>}
                    />
                    <KVRow
                      label="Effective coupon"
                      value={formatEffectiveCouponPct(bondInfo.creditRating.effectiveCouponRate)}
                    />
                  </>
                ) : (
                  <KVRow
                    label="Leverage"
                    value={<span className="text-muted">Loading</span>}
                    mono={false}
                  />
                )}
                <KVRow label={`Costs${suffix}`} value={est(fmt(scale(financials.totalCosts)))} />
              </KVList>
            </div>
          </DenseSection>
        )}

        {!financials && (
          <p className="border-y border-card-border py-2 text-xs text-muted">
            Privately held. Revenue, cash and the books are disclosed to the CEO only.
          </p>
        )}

        <DenseSection
          title="Sectors"
          meta={`${sectors.length} in ${stateCount} ${stateCount === 1 ? "region" : "regions"}`}
          actions={
            <>
              <CorpEconomicModelBadge
                countryId={corporation.countryId}
                sectorType={getOperatingSectorType(
                  corporation.type,
                  corporation.industryModel,
                  corporation.mediaDiscriminator
                )}
              />
              <SmallButton onClick={() => onTabChange("sectors")}>
                {isCeo ? "Manage" : "Details"}
              </SmallButton>
            </>
          }
        >
          {sectors.length === 0 ? (
            <p className="py-2 text-xs text-muted">
              No sectors yet.
              {isCeo ? " Open Sectors to found the first plant." : ""}
            </p>
          ) : (
            <SectorTable
              sectors={sectors}
              corpId={corpId}
              periodView={periodView}
              plantsMode={corporation.plantsMode === true}
              fogged={fogged}
              fmt={fmt}
              fmtSigned={fmtSigned}
            />
          )}
        </DenseSection>
      </div>

      <aside className="min-w-0 space-y-6">
        {myCharacterId && canSeeMarket && !isCeo && (
          <DenseSection
            title="Your position"
            actions={
              onTrade ? (
                <SmallButton tone="primary" onClick={onTrade}>
                  {myShares > 0 ? "Buy / sell" : "Buy shares"}
                </SmallButton>
              ) : undefined
            }
          >
            {myShares > 0 ? (
              <KVList>
                <KVRow label="Shares held" value={myShares.toLocaleString("en-US")} />
                <KVRow
                  label="Ownership"
                  value={`${((myShares / Math.max(1, corporation.totalShares)) * 100).toFixed(2)}%`}
                />
                <KVRow label="Market value" value={fmt(myShares * corporation.sharePrice)} />
              </KVList>
            ) : (
              <p className="py-1 text-xs text-muted">You hold no shares in this corporation.</p>
            )}
          </DenseSection>
        )}

        {openVotes.length > 0 && (
          <DenseSection
            title="Open shareholder votes"
            actions={<SmallButton onClick={() => onTabChange("shares")}>Vote</SmallButton>}
          >
            <table className="w-full border-collapse">
              <tbody>
                {openVotes.map((v) => (
                  <tr key={v._id}>
                    <Td className="text-foreground">{VOTE_LABEL[v.type] ?? v.type}</Td>
                    <Td align="right" numeric={false} className="text-muted">
                      {v.deadlineAtTurn != null ? `closes turn ${v.deadlineAtTurn}` : "open"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DenseSection>
        )}

        <DenseSection title="Operations" meta="change per turn">
          <KVList>
            <KVRow
              label="Marketing strength"
              value={formatMarketingStrength(corporation.marketingStrength)}
              hint={perTurnChangeHint(corporation.marketingStrengthGrowth)}
            />
            <KVRow
              label="Logistics"
              value={formatMarketingStrength(corporation.logisticsStrength)}
              hint={perTurnChangeHint(corporation.logisticsStrengthNetChange)}
            />
            <KVRow
              label="R&D score"
              value={formatMarketingStrength(corporation.rdScore)}
              hint={perTurnChangeHint(corporation.rdScoreNetChange)}
            />
            {brand && <KVRow label="Brand loyalty" value={brand} mono={false} />}
            {corporation.averageQuality != null && (
              <KVRow
                label="Average quality"
                value={`${Math.round(corporation.averageQuality)} / 100`}
              />
            )}
            {physical && (
              <>
                <KVRow
                  label="Capacity"
                  value={formatUnits(physical.capacityUnits)}
                  hint={CAPACITY_UNIT_LABEL}
                />
                <KVRow
                  label="Fill"
                  value={
                    physical.fillRate != null ? `${Math.round(physical.fillRate * 100)}%` : "n/a"
                  }
                  hint={
                    physical.buildingSectorCount > 0
                      ? `${physical.buildingSectorCount} building`
                      : undefined
                  }
                />
              </>
            )}
          </KVList>
        </DenseSection>

        {ownershipSlices.length > 0 && (
          <DenseSection
            title="Ownership"
            meta={`${corporation.shareholders.filter((sh) => sh.shares > 0).length}`}
            actions={<SmallButton onClick={() => onTabChange("shares")}>All</SmallButton>}
          >
            <OwnershipDonut slices={ownershipSlices} />
          </DenseSection>
        )}

        <DenseSection title="Structure">
          <KVList>
            <KVRow
              label="Legal form"
              value={corporation.legalStructureLabel ?? "n/a"}
              mono={false}
            />
            <KVRow label="Headquarters" value={corporation.headquartersStateName} mono={false} />
            {corporation.parentCorporation && (
              <KVRow
                mono={false}
                label="Parent"
                value={
                  <Link
                    href={`/corporation/${corporation.parentCorporation.sequentialId ?? corporation.parentCorporation._id}`}
                    className="hover:underline"
                  >
                    {corporation.parentCorporation.name}
                  </Link>
                }
                hint={`${corporation.parentCorporation.ownershipPct.toFixed(1)}%`}
              />
            )}
            {(corporation.subsidiaries ?? []).map((sub) => (
              <KVRow
                key={sub._id}
                mono={false}
                label="Subsidiary"
                value={
                  <Link
                    href={`/corporation/${sub.sequentialId ?? sub._id}`}
                    className="hover:underline"
                  >
                    {sub.name}
                  </Link>
                }
                hint={`${sub.ownershipPct.toFixed(1)}%`}
              />
            ))}
            <KVRow label="Founded" value={<GameMonthTime value={corporation.createdAt} />} />
          </KVList>
        </DenseSection>
      </aside>
    </div>
  );
}
