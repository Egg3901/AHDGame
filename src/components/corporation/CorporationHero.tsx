"use client";
import { MONEY_PERIOD_SUFFIX, scaleMoney, type MoneyPeriod } from "@/lib/constants/moneyTimescale";

import { useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import BackButton from "@/components/BackButton";
import { getTypeColor } from "@/components/corporation/CorporationHelpers";
import { NationalizationRiskBadge } from "@/components/corporation/NationalizationRiskBadge";
import { FacingNationalizationBadge } from "@/components/corporation/FacingNationalizationBadge";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

import type { CurrencyCode } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail, CEO, FinancialFogMeta } from "./CorporationPageTypes";
import { regionUrl } from "@/lib/urls";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { CeoCorporationSettingsModal } from "@/components/corporation/ceo/CeoCorporationSettingsModal";
import { CorporationBrandingModal } from "@/components/corporation/ceo/CorporationBrandingModal";
import { formatMarketingStrength } from "@/lib/utils/formatters";
import { loyaltyLabel } from "@/lib/market/brandLoyalty";
import { corporationWikiSlug } from "@/lib/wiki/playerPages";
import {
  TickerTile,
  LiveBadge,
  Sparkline,
  Change,
  EstChip,
} from "@/components/corporation/market/MarketPrimitives";
import { useSharePriceHistory } from "@/components/corporation/market/useSharePriceHistory";
import { deriveTicker } from "@/components/corporation/market/corpIdentity";

const DEFAULT_BRAND = "#3b82f6";

/** Compact vital tile — min-w-0 so grid cells never shove neighbors. */
function StatTile({
  label,
  children,
  title,
  estimated = false,
}: {
  label: string;
  children: ReactNode;
  title?: string;
  estimated?: boolean;
}) {
  return (
    <div className="flex min-h-[4.75rem] flex-col justify-between gap-1 p-3 sm:p-4" title={title}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
        <span className="truncate">{label}</span>
        {estimated && (
          <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[9px] font-semibold normal-case tracking-wider text-warning">
            Est.
          </span>
        )}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface CorporationHeroProps {
  corporation: CorporationDetail;
  ceo: CEO | null;
  brandHex: string;
  isCeo: boolean;
  onRefresh: () => void;
  /** Exchange short label (e.g. "NYSE") for the ticker chip + live badge. */
  exchangeLabel: string;
  /** Corporation id (sequential or _id) used by the share-price history fetch. */
  corpId: string;
  /** Current credit rating (from bondInfo), shown in the investor strip when present. */
  creditRating?: string;
  sectorCount?: number;
  stateCount?: number;
  income?: number | null;
  periodView?: MoneyPeriod;
  financialFogOfWar?: FinancialFogMeta | null;
  ceoIsInactive?: boolean;
}

export function CorporationHero({
  corporation,
  ceo,
  brandHex,
  isCeo,
  onRefresh,
  exchangeLabel,
  corpId,
  creditRating,
  sectorCount,
  stateCount,
  income,
  periodView = "daily",
  financialFogOfWar,
  ceoIsInactive = false,
}: CorporationHeroProps) {
  const { user } = useAuthMe();
  // The redesigned corporation hero is the default; explicit opt-out is classic.
  const enableExperimentalUI = user?.enableExperimentalUI !== false;
  const { formatAmount, formatPrice, formatPriceIn, formatFull, toInternalFrom } = useCurrency();
  const accent = brandHex || DEFAULT_BRAND;
  const hasHeader = Boolean(corporation.headerImageUrl);

  // Market identity applies to player-owned corps only; national corps keep
  // their existing presentation untouched.
  const isPlayerCorp = !corporation.countryOwnerId;
  const ticker = deriveTicker({ tickerSymbol: corporation.tickerSymbol, name: corporation.name });
  // A public corp's market price is public knowledge; a private corp exposes it
  // only to its CEO (mirrors the existing financial fog rules).
  const priceVisible = !corporation.isPrivate || isCeo;
  const showMarket = isPlayerCorp && priceVisible;
  const { series: priceSeries, dayChange } = useSharePriceHistory(corpId, showMarket);

  const corpCurrency = corporation.liquidCurrencyCode as CurrencyCode | undefined;
  // A share trades on its home exchange in its home currency, so the masthead
  // price must always render in that currency. Forcing native (formatPriceIn)
  // rather than the viewer's display preference stops a weak-currency price
  // (e.g. an NGX-listed corp at thousands of naira) from being converted into a
  // sub-cent "$0.00" under a USD or anchor display preference.
  const sharePriceDisplay = corpCurrency
    ? formatPriceIn(toInternalFrom(corporation.sharePrice, corpCurrency), corpCurrency)
    : formatPrice(corporation.sharePrice, corpCurrency);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBanner(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corporation._id);
      const res = await fetch("/api/upload/corporation-header", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) setUploadError(data.error || "Failed to upload banner");
      else onRefresh();
    } catch {
      setUploadError("Network error");
    } finally {
      setUploadingBanner(false);
      e.target.value = "";
    }
  }

  async function handleClearBanner() {
    setUploadingBanner(true);
    setUploadError("");
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerImageUrl: null }),
      });
      const data = await res.json();
      if (!res.ok) setUploadError(data.error || "Failed to remove banner");
      else onRefresh();
    } catch {
      setUploadError("Network error");
    } finally {
      setUploadingBanner(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corpId);
      const res = await fetch("/api/upload/corporation-logo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) setUploadError(data.error || "Failed to upload logo");
      else onRefresh();
    } catch {
      setUploadError("Network error");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  const fogTurnLabel =
    financialFogOfWar?.fogSourceTurn != null
      ? `Q${financialFogOfWar.fogSourceTurn}`
      : "last quarter";

  // Fog-aware income tile (shared by both strip variants).
  const incomeTile = (() => {
    const code = corporation.liquidCurrencyCode as CurrencyCode | undefined;
    const label = `Income ${MONEY_PERIOD_SUFFIX[periodView]}`;
    if (income == null) {
      return (
        <StatTile label={label}>
          <span className="text-lg font-bold tabular-nums text-muted">—</span>
        </StatTile>
      );
    }
    const raw = Math.round(scaleMoney(income, periodView));
    const anchor = code ? toInternalFrom(raw, code) : raw;
    const display = `${income >= 0 ? "+" : ""}${formatAmount(anchor, code)}`;
    const tone = income >= 0 ? "text-success" : "text-error";

    if (financialFogOfWar) {
      const qIncome = financialFogOfWar.lastQuarterly.income;
      let qHint: string | undefined;
      if (qIncome != null) {
        const qRaw = Math.round(scaleMoney(qIncome, periodView));
        const qAnchor = code ? toInternalFrom(qRaw, code) : qRaw;
        qHint = `${fogTurnLabel} reported ${qIncome >= 0 ? "+" : ""}${formatAmount(qAnchor, code)}`;
      }
      return (
        <StatTile
          label={label}
          estimated
          title={qHint ? `Estimated · ${qHint}` : "Estimated from last quarterly report"}
        >
          <span className={`block truncate text-lg font-bold tabular-nums ${tone}`}>
            ~{display}
          </span>
          <span className="text-[10px] text-muted">not live · CEO-only exact</span>
        </StatTile>
      );
    }

    return (
      <StatTile label={label}>
        <span className={`block truncate text-lg font-bold tabular-nums ${tone}`}>{display}</span>
      </StatTile>
    );
  })();

  // Fog-aware liquid-capital tile — compact $2.8B, never a full digit dump.
  const liquidTile = (() => {
    const code = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
    if (corporation.liquidCapital == null && !financialFogOfWar) {
      return (
        <StatTile label="Liquid capital">
          <span className="text-lg font-bold tabular-nums text-muted">—</span>
        </StatTile>
      );
    }

    if (financialFogOfWar) {
      const est = formatAmount(toInternalFrom(corporation.liquidCapital, code), code);
      const qLiq = financialFogOfWar.lastQuarterly.liquidCapital;
      const qHint =
        qLiq != null
          ? `${fogTurnLabel} reported ${formatAmount(toInternalFrom(qLiq, code), code)}`
          : undefined;
      return (
        <StatTile
          label="Liquid capital"
          estimated
          title={
            qHint
              ? `Estimated · ${qHint} · exact ${formatFull(toInternalFrom(corporation.liquidCapital, code), code)}`
              : `Estimated · exact ${formatFull(toInternalFrom(corporation.liquidCapital, code), code)}`
          }
        >
          <span className="block truncate text-lg font-bold tabular-nums text-warning">~{est}</span>
          <span className="text-[10px] text-muted">cash on hand · estimated</span>
        </StatTile>
      );
    }

    return (
      <StatTile
        label="Liquid capital"
        title={formatFull(toInternalFrom(corporation.liquidCapital!, code), code)}
      >
        <span className="block truncate text-lg font-bold tabular-nums text-foreground">
          {formatAmount(toInternalFrom(corporation.liquidCapital!, code), code)}
        </span>
        <span className="text-[10px] text-muted">cash on hand</span>
      </StatTile>
    );
  })();

  // Market-cap tile (public / not fogged).
  const marketCapTile = (
    <StatTile label="Market cap">
      <span className="block truncate text-lg font-bold tabular-nums text-foreground">
        {(() => {
          const code = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
          const anchor = code
            ? toInternalFrom(corporation.marketCapitalization, code)
            : corporation.marketCapitalization;
          return formatAmount(anchor, code);
        })()}
      </span>
      <span className="text-[10px] text-muted">live market</span>
    </StatTile>
  );

  // Brand loyalty is shown ONLY as the hidden 5-label scale, never the number.
  // Prefer the server-computed label (sent to everyone); fall back to deriving
  // it from the raw number when the owner receives it. Absent ⇒ hide the tile.
  const brandLabel =
    corporation.brandLoyaltyLabel ??
    (corporation.brandLoyalty != null ? loyaltyLabel(corporation.brandLoyalty) : undefined);
  const brandTile = brandLabel ? (
    <StatTile label="Brand">
      <span className="block truncate text-lg font-bold leading-tight text-foreground">
        {brandLabel}
      </span>
      <span className="text-[10px] text-muted">brand loyalty</span>
    </StatTile>
  ) : null;
  const avgQualityTile =
    corporation.averageQuality != null ? (
      <StatTile label="Avg quality">
        <span className="block truncate text-lg font-bold tabular-nums leading-tight text-foreground">
          {Math.round(corporation.averageQuality)}
        </span>
        <span className="text-[10px] text-muted">out of 100</span>
      </StatTile>
    ) : null;

  const fogRibbon = financialFogOfWar ? (
    <div className="flex items-start gap-2.5 border-t border-warning/30 bg-warning/[0.08] px-3 py-2.5 sm:px-4">
      <EstChip turn={financialFogOfWar.fogSourceTurn} />
      <p className="min-w-0 text-[11px] leading-snug text-foreground/90">
        <span className="font-semibold text-warning">Estimates only.</span> Income and liquid
        capital below are ~guesses from {fogTurnLabel}. Share price and market cap stay{" "}
        <span className="font-semibold">live</span>. Exact books are CEO-only.
      </p>
    </div>
  ) : null;

  return (
    <header
      className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg"
      style={{ ["--brand" as string]: accent } as CSSProperties}
    >
      <div className="relative h-[175px] w-full sm:h-[220px]">
        {hasHeader ? (
          <HeroImage
            src={corporation.headerImageUrl as string}
            alt=""
            fill
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
          />
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-card via-card-elevated to-card"
            style={{
              backgroundImage: isPlayerCorp
                ? `radial-gradient(120% 150% at 100% 0%, ${accent}40 0%, transparent 46%), linear-gradient(135deg, ${accent}38 0%, var(--card-elevated, #26263a) 52%, var(--card, #1d1d2a) 100%)`
                : `linear-gradient(135deg, ${accent}40 0%, transparent 42%, ${accent}28 100%)`,
            }}
            aria-hidden
          />
        )}

        {/* Faint ticker watermark — player corps without a custom banner only. */}
        {isPlayerCorp && !hasHeader && (
          <div
            className="pointer-events-none absolute -right-3 -top-6 select-none font-mono font-bold text-white/[0.06]"
            style={{ fontSize: 150, lineHeight: 1 }}
            aria-hidden
          >
            {ticker}
          </div>
        )}

        <div
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
          aria-hidden
        />

        <div className="absolute top-0 left-0 right-0 z-10 flex items-start justify-between gap-2 px-4 pt-3 sm:px-6 sm:pt-4">
          <BackButton iconOnly />
          {isCeo && (
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(true);
                setUploadError("");
              }}
              aria-label="Corporation branding settings"
              className="rounded-lg border border-white/25 bg-black/35 p-1.5 text-white/90 backdrop-blur-sm hover:bg-black/50 transition-colors"
            >
              {/* gear / settings icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="absolute inset-0 flex flex-col justify-end px-4 pb-4 sm:px-6 sm:pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            {corporation.logoUrl ? (
              <div className="shrink-0 rounded-xl border border-white/25 bg-black/20 p-0.5 shadow-lg backdrop-blur-sm">
                <Image
                  src={corporation.logoUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="h-14 w-14 rounded-[10px] object-cover sm:h-16 sm:w-16"
                  sizes="64px"
                  unoptimized={bypassNextImageOptimization(corporation.logoUrl)}
                />
              </div>
            ) : (
              isPlayerCorp && (
                <TickerTile text={ticker} size={64} className="shadow-lg sm:!h-16 sm:!w-16" />
              )
            )}
            <div className="min-w-0 flex-1">
              {/* Market eyebrow — "{EXCHANGE} LISTED EQUITY" + ticker chip, above the
                  name (player corps only; mirrors the market-identity design). */}
              {isPlayerCorp && (
                <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.16em] drop-shadow"
                    style={{ color: "color-mix(in srgb, var(--brand, #3b82f6) 55%, white)" }}
                  >
                    {exchangeLabel} Listed Equity
                  </span>
                  <span className="inline-flex items-center rounded border border-white/20 bg-black/35 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-white/95 backdrop-blur-sm">
                    {exchangeLabel}: {ticker}
                  </span>
                </div>
              )}
              <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                {corporation.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm ${getTypeColor(corporation.type)}`}
                >
                  {corporation.typeLabel}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm ${
                    corporation.isPrivate
                      ? "border-muted/40 bg-black/40 text-white/90"
                      : "border-info/50 bg-info/20 text-white/95"
                  }`}
                >
                  {corporation.isPrivate ? "Private" : "Public"}
                </span>
                <NationalizationRiskBadge risk={corporation.nationalizationRisk} />
                <FacingNationalizationBadge threat={corporation.nationalizationThreat} />
                {isPlayerCorp && corporation.legalStructureLabel && (
                  <span className="inline-flex items-center rounded-full border border-muted/40 bg-black/30 px-2.5 py-0.5 text-xs font-medium text-white/85 backdrop-blur-sm">
                    {corporation.legalStructureLabel}
                  </span>
                )}
                {corporation.countryOwnerId && (
                  <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/20 px-2.5 py-0.5 text-xs font-medium text-warning backdrop-blur-sm">
                    National Corporation{corporation.isNationalized ? " (Nationalized)" : ""}
                  </span>
                )}
                {corporation.parentCorporation && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-muted/50 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/95 backdrop-blur-sm">
                    <span className="text-white/75">Subsidiary</span>
                    <Link
                      href={`/corporation/${corporation.parentCorporation.sequentialId ?? corporation.parentCorporation._id}`}
                      className="font-semibold text-white hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {corporation.parentCorporation.name}
                    </Link>
                    <span className="text-white/70 tabular-nums">
                      ({corporation.parentCorporation.ownershipPct.toFixed(1)}%)
                    </span>
                  </span>
                )}
                {corporation.countryId && corporation.headquartersState && (
                  <Link
                    href={regionUrl(corporation.countryId, corporation.headquartersState)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white"
                  >
                    {STATE_FLAGS[corporation.headquartersState] && (
                      <Image
                        src={STATE_FLAGS[corporation.headquartersState]}
                        alt=""
                        width={18}
                        height={12}
                        className="rounded-sm object-cover"
                        unoptimized={bypassNextImageOptimization(
                          STATE_FLAGS[corporation.headquartersState]
                        )}
                      />
                    )}
                    <span>HQ {corporation.headquartersStateName}</span>
                  </Link>
                )}
                {typeof corporation.sequentialId === "number" && (
                  <Link
                    href={`/wiki/${corporationWikiSlug(corporation.sequentialId)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/95 backdrop-blur-sm hover:bg-black/40"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                    </svg>
                    Wiki
                  </Link>
                )}
              </div>

              <div className="mt-3">
                {corporation.ceoVacant || !ceo ? (
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <span className="inline-block h-2 w-2 rounded-full bg-warning/80" />
                    CEO vacant
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={ceo.profilePath ?? `/character/${ceo.sequentialId}`}
                      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-black/25 px-2 py-1 text-sm text-white/95 backdrop-blur-sm hover:bg-black/40"
                    >
                      <Avatar
                        url={ceo.avatarUrl}
                        name={ceo.name}
                        size="h-7 w-7"
                        className="rounded-md"
                        borderKey={ceo.borderKey}
                        tintColor={ceo.tintColor}
                      />
                      <span className="font-medium truncate">{ceo.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-white/60">
                        CEO
                      </span>
                    </Link>
                    {ceoIsInactive && (
                      <span
                        className="inline-flex items-center rounded-full border border-warning/40 bg-warning/20 px-2.5 py-0.5 text-xs font-medium text-warning backdrop-blur-sm"
                        title="CEO has not been online in over 72 hours. 10% of each sector's revenue and workforce moves to the unowned-sector pool each turn until they return."
                      >
                        Inactive CEO — shedding 10%/turn
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Live market price block — player corps with a visible price. */}
            {showMarket && (
              <div className="shrink-0 sm:ml-auto sm:text-right">
                <div className="flex items-center gap-2 sm:justify-end">
                  <LiveBadge exchange={exchangeLabel} />
                </div>
                <div className="mt-2 flex items-end gap-2 sm:justify-end">
                  <span className="font-mono text-2xl font-bold tabular-nums text-white drop-shadow-md sm:text-3xl">
                    {sharePriceDisplay}
                  </span>
                  {dayChange && <Change pct={dayChange.changePct} className="mb-1 !text-sm" />}
                </div>
                {priceSeries.length >= 2 && (
                  <div className="mt-1 flex justify-start sm:justify-end">
                    <Sparkline data={priceSeries} up={(dayChange?.changePct ?? 0) >= 0} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {enableExperimentalUI ? (
        <CeoCorporationSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          corporation={corporation}
          corpId={corpId}
          onRefresh={onRefresh}
        />
      ) : (
        <CorporationBrandingModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          corporation={corporation}
          uploadingLogo={uploadingLogo}
          uploadingBanner={uploadingBanner}
          uploadError={uploadError}
          onLogoUpload={handleLogoUpload}
          onBannerUpload={handleBannerUpload}
          onClearBanner={handleClearBanner}
        />
      )}

      {isPlayerCorp ? (
        <>
          {fogRibbon}
          <HeroStatsStrip variant="overlay" layout="grid">
            {marketCapTile}
            <StatTile label="Day change">
              {dayChange ? (
                <>
                  <span
                    className={`block truncate text-lg font-bold tabular-nums leading-tight ${dayChange.changePct >= 0 ? "text-success" : "text-error"}`}
                  >
                    {dayChange.changePct >= 0 ? "+" : ""}
                    {dayChange.changePct.toFixed(2)}%
                  </span>
                  <span className="text-[10px] tabular-nums text-muted">
                    prev{" "}
                    {corpCurrency
                      ? formatPriceIn(
                          toInternalFrom(dayChange.prevClose, corpCurrency),
                          corpCurrency
                        )
                      : formatPrice(dayChange.prevClose, corpCurrency)}
                  </span>
                </>
              ) : (
                <span className="text-lg font-bold tabular-nums text-muted">—</span>
              )}
            </StatTile>
            <StatTile label="Dividend">
              <span className="block truncate text-lg font-bold tabular-nums leading-tight text-foreground">
                {corporation.dividendRate != null ? `${corporation.dividendRate}%` : "—"}
              </span>
              <span className="text-[10px] text-muted">
                {corporation.dividendRate != null ? "payout of income" : "not disclosed"}
              </span>
            </StatTile>
            {incomeTile}
            {liquidTile}
            {corporation.marketingStrength != null && (
              <StatTile label="Mkt strength">
                <span className="block truncate text-lg font-bold tabular-nums text-foreground leading-tight">
                  {formatMarketingStrength(corporation.marketingStrength)} pts
                </span>
                <span
                  className={`text-[10px] tabular-nums ${corporation.marketingStrengthGrowth >= 0 ? "text-success" : "text-error"}`}
                >
                  {corporation.marketingStrengthGrowth >= 0 ? "+" : ""}
                  {corporation.marketingStrengthGrowth.toFixed(2)}/turn
                </span>
              </StatTile>
            )}
            {creditRating && (
              <StatTile label="Credit rating">
                <span className="block truncate text-lg font-bold tabular-nums leading-tight text-foreground">
                  {creditRating}
                </span>
                {corporation.publicFloat != null && corporation.totalShares > 0 && (
                  <span className="text-[10px] text-muted">
                    public float{" "}
                    {((corporation.publicFloat / corporation.totalShares) * 100).toFixed(1)}%
                  </span>
                )}
              </StatTile>
            )}
            {brandTile}
            {avgQualityTile}
          </HeroStatsStrip>
        </>
      ) : (
        <>
          {fogRibbon}
          <HeroStatsStrip variant="overlay" layout="grid">
            <StatTile label="Share price">
              <span className="block truncate text-lg font-bold tabular-nums text-foreground">
                {sharePriceDisplay}
              </span>
            </StatTile>
            {marketCapTile}
            <StatTile label="Mkt strength">
              <span className="block truncate text-lg font-bold tabular-nums text-foreground leading-tight">
                {formatMarketingStrength(corporation.marketingStrength)} pts
              </span>
              <span
                className={`text-[10px] tabular-nums ${corporation.marketingStrengthGrowth >= 0 ? "text-success" : "text-error"}`}
              >
                {corporation.marketingStrengthGrowth >= 0 ? "+" : ""}
                {corporation.marketingStrengthGrowth.toFixed(2)}/turn
              </span>
            </StatTile>
            <StatTile label="Log. efficiency">
              <span className="block truncate text-lg font-bold tabular-nums text-foreground leading-tight">
                {Math.round(corporation.logisticsStrength).toLocaleString("en-US")} pts
              </span>
              <span
                className={`text-[10px] tabular-nums ${corporation.logisticsStrengthNetChange >= 0 ? "text-success" : "text-error"}`}
              >
                {corporation.logisticsStrengthNetChange >= 0 ? "+" : ""}
                {corporation.logisticsStrengthNetChange.toFixed(3)}/turn
              </span>
            </StatTile>
            {incomeTile}
            {liquidTile}
            {sectorCount !== undefined && (
              <StatTile label="Sectors">
                <span className="block truncate text-lg font-bold tabular-nums text-foreground leading-tight">
                  {sectorCount}
                </span>
                {stateCount !== undefined && (
                  <span className="text-[10px] text-muted">
                    {stateCount} {stateCount === 1 ? "state" : "states"}
                  </span>
                )}
              </StatTile>
            )}
            {brandTile}
            {avgQualityTile}
          </HeroStatsStrip>
        </>
      )}
    </header>
  );
}
