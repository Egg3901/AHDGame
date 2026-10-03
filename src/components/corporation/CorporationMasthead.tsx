"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { HeroImage } from "@/components/HeroImage";
import { STATE_FLAGS } from "@/lib/constants";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { MONEY_PERIOD_SUFFIX, scaleMoney, type MoneyPeriod } from "@/lib/constants/moneyTimescale";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { loyaltyLabel } from "@/lib/market/brandLoyalty";
import { regionUrl } from "@/lib/urls";
import { formatCompactNumber, formatMarketingStrength } from "@/lib/utils/formatters";
import { corporationWikiSlug } from "@/lib/wiki/playerPages";
import { CeoCorporationSettingsModal } from "./ceo/CeoCorporationSettingsModal";
import { deriveTicker } from "./market/corpIdentity";
import { useSharePriceHistory } from "./market/useSharePriceHistory";
import { MiniSparkline, SmallButton, signTone, useCorpMoney } from "./dense/DenseKit";
import type { CEO, CorporationDetail, FinancialFogMeta } from "./CorporationPageTypes";

interface CorporationMastheadProps {
  corporation: CorporationDetail;
  ceo: CEO | null;
  isCeo: boolean;
  /** Sequential id or _id from the URL; drives the price-history fetch. */
  corpId: string;
  /** Short exchange name ("NYSE"), or "Global" for a country with no venue. */
  exchangeLabel: string;
  creditRating?: string;
  /** Retained income after dividends, daily basis, corp currency. */
  retainedDaily: number | null;
  /** What the corp pays out: max(CEO rate, legal floor, parent floor). */
  effectiveDividendRate: number | null;
  periodView: MoneyPeriod;
  financialFogOfWar: FinancialFogMeta | null;
  ceoIsInactive: boolean;
  onRefresh: () => void;
  /** Opens the trade ticket. Omitted when the viewer cannot trade here. */
  onTrade?: () => void;
  /** Show the CEO-uploaded banner strip (the page passes true on Overview only). */
  showBanner?: boolean;
}

/** Inline "label value" pair for the figures row. */
function Figure({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-muted/50">
      ·
    </span>
  );
}

/**
 * Corporation page header: identity, the quote, and one row of key figures.
 *
 * Replaces the banner hero. Everything a player scans for (price, change,
 * market cap, cash, dividend, credit) sits in two lines at body size, and the
 * one action the viewer can take from here (trade, or settings for the CEO)
 * is a button, not a decoration.
 */
export function CorporationMasthead({
  corporation,
  ceo,
  isCeo,
  corpId,
  exchangeLabel,
  creditRating,
  retainedDaily,
  effectiveDividendRate,
  periodView,
  financialFogOfWar,
  ceoIsInactive,
  onRefresh,
  onTrade,
  showBanner = false,
}: CorporationMastheadProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const money = useCorpMoney(corporation.liquidCurrencyCode);
  const ticker = deriveTicker({ tickerSymbol: corporation.tickerSymbol, name: corporation.name });

  // A public corp's price is public knowledge; a private corp shows it only to
  // its CEO (mirrors the financial fog rules on the API).
  const priceVisible = !corporation.isPrivate || isCeo;
  const { series, dayChange } = useSharePriceHistory(corpId, priceVisible);

  const fogged = financialFogOfWar != null;
  const fogTitle = fogged
    ? `Estimated from the ${
        financialFogOfWar.fogSourceTurn != null ? `turn ${financialFogOfWar.fogSourceTurn}` : "last"
      } quarterly report, within ±${Math.round(financialFogOfWar.maxDeviation * 100)}%. Exact books are CEO-only.`
    : undefined;
  const est = (text: string) => (fogged ? `~${text}` : text);

  const typeLabel = corporation.secondaryType
    ? `${corporation.typeLabel} / ${CORPORATION_TYPE_LABELS[corporation.secondaryType]}`
    : corporation.typeLabel;

  const hqFlag = STATE_FLAGS[corporation.headquartersState];
  const brand =
    corporation.brandLoyaltyLabel ??
    (corporation.brandLoyalty != null ? loyaltyLabel(corporation.brandLoyalty) : undefined);
  const dividendRate = effectiveDividendRate ?? corporation.dividendRate ?? null;
  const dividendIsFloor =
    effectiveDividendRate != null &&
    corporation.dividendRate != null &&
    effectiveDividendRate > corporation.dividendRate;
  const floatPct =
    corporation.totalShares > 0 && Number.isFinite(corporation.publicFloat)
      ? (corporation.publicFloat / corporation.totalShares) * 100
      : null;
  const hasPrice = priceVisible && Number.isFinite(corporation.sharePrice);
  const hasQuote =
    hasPrice &&
    corporation.equityMarketPoolActive === true &&
    Number.isFinite(corporation.marketBidPrice) &&
    Number.isFinite(corporation.marketAskPrice);

  const nationalizationRisk = corporation.nationalizationRisk;
  const threat = corporation.nationalizationThreat;
  const threatActive = threat != null && (threat.whole || threat.sectorCount > 0);

  return (
    <header className="space-y-2">
      {/* A CEO-uploaded banner is the corp's own identity, so it stays on the
          Overview, as a plain strip with nothing printed over it. */}
      {showBanner && corporation.headerImageUrl && (
        <div className="relative h-14 overflow-hidden rounded-md border border-card-border sm:h-20">
          <HeroImage
            src={corporation.headerImageUrl}
            alt=""
            fill
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
          />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {corporation.logoUrl && (
            <Image
              src={corporation.logoUrl}
              alt=""
              width={40}
              height={40}
              className="mt-0.5 h-10 w-10 shrink-0 rounded-md border border-card-border object-cover"
              sizes="40px"
              unoptimized={bypassNextImageOptimization(corporation.logoUrl)}
            />
          )}
          <div className="min-w-0">
            <h1 className="corp-masthead-title truncate text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
              {corporation.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span className="font-medium text-foreground">
                {exchangeLabel}: {ticker}
              </span>
              <Sep />
              <span>{typeLabel}</span>
              {corporation.legalStructureLabel && (
                <>
                  <Sep />
                  <span>{corporation.legalStructureLabel}</span>
                </>
              )}
              <Sep />
              <span>{corporation.isPrivate ? "Private" : "Public"}</span>
              {corporation.countryId && corporation.headquartersState && (
                <>
                  <Sep />
                  <Link
                    href={regionUrl(corporation.countryId, corporation.headquartersState)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {hqFlag && (
                      <Image
                        src={hqFlag}
                        alt=""
                        width={16}
                        height={11}
                        className="h-[11px] w-4 rounded-[2px] object-cover"
                        unoptimized={bypassNextImageOptimization(hqFlag)}
                      />
                    )}
                    HQ {corporation.headquartersStateName}
                  </Link>
                </>
              )}
              <Sep />
              {corporation.ceoVacant || !ceo ? (
                <span className="text-warning">CEO vacant</span>
              ) : (
                <Link
                  href={ceo.profilePath ?? `/character/${ceo.sequentialId}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Avatar
                    url={ceo.avatarUrl}
                    name={ceo.name}
                    size="h-4 w-4"
                    className="rounded-sm"
                    borderKey={ceo.borderKey}
                    tintColor={ceo.tintColor}
                  />
                  <span>
                    CEO <span className="text-foreground">{ceo.name}</span>
                  </span>
                </Link>
              )}
              {corporation.parentCorporation && (
                <>
                  <Sep />
                  <span>
                    Subsidiary of{" "}
                    <Link
                      href={`/corporation/${corporation.parentCorporation.sequentialId ?? corporation.parentCorporation._id}`}
                      className="text-foreground hover:underline"
                    >
                      {corporation.parentCorporation.name}
                    </Link>{" "}
                    <span className="tabular-nums">
                      ({corporation.parentCorporation.ownershipPct.toFixed(1)}%)
                    </span>
                  </span>
                </>
              )}
              {typeof corporation.sequentialId === "number" && (
                <>
                  <Sep />
                  <Link
                    href={`/wiki/${corporationWikiSlug(corporation.sequentialId)}`}
                    className="hover:text-foreground"
                  >
                    Wiki
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onTrade && (
            <SmallButton tone="primary" onClick={onTrade}>
              Trade shares
            </SmallButton>
          )}
          {isCeo && (
            <SmallButton onClick={() => setSettingsOpen(true)} ariaLabel="Corporation settings">
              Settings
            </SmallButton>
          )}
        </div>
      </div>

      {(ceoIsInactive || nationalizationRisk || threatActive) && (
        <ul className="space-y-0.5 text-xs">
          {ceoIsInactive && (
            <li
              className="text-warning"
              title="The CEO has not been online in over 72 hours. 10% of each sector's revenue and workforce moves to the unowned-sector pool each turn until they return."
            >
              Inactive CEO: shedding 10% of each sector per turn until they return.
            </li>
          )}
          {nationalizationRisk && (
            <li
              className="text-warning"
              title="A government may nationalize this corporation once it has been in financial distress past the grace window."
            >
              {nationalizationRisk.turnsUntilEligible <= 0
                ? "In financial distress: eligible for nationalization now."
                : `In financial distress: eligible for nationalization in ${nationalizationRisk.turnsUntilEligible} turn${
                    nationalizationRisk.turnsUntilEligible === 1 ? "" : "s"
                  }.`}
            </li>
          )}
          {threatActive && threat && (
            <li
              className="text-error"
              title="This corporation is the target of a legislative nationalization: a passed taking in its notice window, or a bill still in voting."
            >
              Facing nationalization (
              {threat.whole
                ? threat.sectorCount > 0
                  ? `whole corporation and ${threat.sectorCount} sector${threat.sectorCount === 1 ? "" : "s"}`
                  : "whole corporation"
                : `${threat.sectorCount} sector${threat.sectorCount === 1 ? "" : "s"}`}
              ):{" "}
              {threat.turnsUntilTaking == null
                ? "bill in voting."
                : threat.turnsUntilTaking <= 0
                  ? "taking is due this turn."
                  : `taking in ${threat.turnsUntilTaking} turn${threat.turnsUntilTaking === 1 ? "" : "s"}.`}
            </li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-card-border py-2">
        {hasPrice && (
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums text-foreground">
                {money.fmtPrice(corporation.sharePrice)}
              </span>
              {dayChange && (
                <span
                  className={`text-[13px] font-medium tabular-nums ${signTone(dayChange.changePct)}`}
                  title={`Previous turn ${money.fmtPrice(dayChange.prevClose)}`}
                >
                  {dayChange.changePct >= 0 ? "+" : ""}
                  {dayChange.changePct.toFixed(2)}%
                </span>
              )}
            </div>
            <MiniSparkline data={series} label="Share price, recent turns" />
          </div>
        )}

        <dl className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
          {hasQuote && (
            <Figure
              label="Bid / Ask"
              title="The equity market pool's live quote. Market sales fill at the bid, purchases at the ask."
            >
              {money.fmtPrice(corporation.marketBidPrice as number)} /{" "}
              {money.fmtPrice(corporation.marketAskPrice as number)}
            </Figure>
          )}
          {priceVisible && Number.isFinite(corporation.marketCapitalization) && (
            <Figure label="Mkt cap">{money.fmt(corporation.marketCapitalization)}</Figure>
          )}
          {Number.isFinite(corporation.totalShares) && corporation.totalShares > 0 && (
            <Figure label="Shares">{formatCompactNumber(corporation.totalShares)}</Figure>
          )}
          {!corporation.isPrivate && floatPct != null && (
            <Figure label="Float" title="Shares anyone can buy on the market.">
              {floatPct.toFixed(1)}%
            </Figure>
          )}
          {dividendRate != null && (
            <Figure
              label="Dividend"
              title={
                dividendIsFloor
                  ? `Legal minimum payout. The CEO has set ${corporation.dividendRate}%.`
                  : "Share of net income paid out to shareholders each turn."
              }
            >
              {dividendRate}%{dividendIsFloor ? " floor" : ""}
            </Figure>
          )}
          {retainedDaily != null && (
            <Figure
              label={`Retained${MONEY_PERIOD_SUFFIX[periodView]}`}
              title={fogTitle ?? "Net income kept by the company after dividends."}
            >
              <span className={signTone(retainedDaily)}>
                {est(money.fmtSigned(Math.round(scaleMoney(retainedDaily, periodView))))}
              </span>
            </Figure>
          )}
          {Number.isFinite(corporation.liquidCapital) && (
            <Figure label="Cash" title={fogTitle ?? money.fmtFull(corporation.liquidCapital)}>
              {est(money.fmt(corporation.liquidCapital))}
            </Figure>
          )}
          {creditRating && <Figure label="Credit">{creditRating}</Figure>}
          {Number.isFinite(corporation.marketingStrength) && (
            <Figure label="Marketing" title="Marketing strength and its change per turn.">
              {formatMarketingStrength(corporation.marketingStrength)}
              {Number.isFinite(corporation.marketingStrengthGrowth) &&
                corporation.marketingStrengthGrowth !== 0 && (
                  <span
                    className={`ml-1 text-[11px] font-normal ${signTone(corporation.marketingStrengthGrowth)}`}
                  >
                    {corporation.marketingStrengthGrowth > 0 ? "+" : ""}
                    {corporation.marketingStrengthGrowth.toFixed(2)}
                  </span>
                )}
            </Figure>
          )}
          {brand && <Figure label="Brand">{brand}</Figure>}
          {corporation.averageQuality != null && (
            <Figure label="Quality" title="Average product quality, out of 100.">
              {Math.round(corporation.averageQuality)}
            </Figure>
          )}
        </dl>
      </div>

      {fogged && (
        <p className="text-[11px] text-muted">
          ~ marks an estimate from the{" "}
          {financialFogOfWar.fogSourceTurn != null
            ? `turn ${financialFogOfWar.fogSourceTurn}`
            : "last"}{" "}
          quarterly report. Price and market cap are live. Exact books are visible to the CEO only.
        </p>
      )}

      {isCeo && (
        <CeoCorporationSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          corporation={corporation}
          corpId={corpId}
          onRefresh={onRefresh}
        />
      )}
    </header>
  );
}
