"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { CommodityData, ExchangeData } from "@/app/country/[code]/stockmarket/types";
import {
  BONDS_URL,
  FUNDS_URL,
  STOCKS_URL,
  type BondsResponse,
  type FundsResponse,
  type SectorsForSaleResponse,
} from "./MarketPanels";
import { vsBasePct } from "./CommoditiesPanel";
import type { SupplyOffersResponse } from "./SupplyDealsPanel";
import { PreviewCard, PreviewRow, pctText, toneClass } from "./marketUi";
import { useMarketJson } from "./useMarketJson";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";

const byDesc =
  <T,>(score: (t: T) => number) =>
  (a: T, b: T) =>
    score(b) - score(a);

export function MarketOverview({
  commodities,
  sectors,
  offers,
  loading,
}: {
  commodities: CommodityData[] | null;
  sectors: SectorsForSaleResponse | null;
  offers: SupplyOffersResponse | null;
  loading: boolean;
}) {
  const { formatAmount, formatListingPrice } = useCurrency();
  const stocks = useMarketJson<ExchangeData>(STOCKS_URL);
  const bonds = useMarketJson<BondsResponse>(BONDS_URL);
  const funds = useMarketJson<FundsResponse>(FUNDS_URL);

  const topStocks = (stocks.data?.listings ?? [])
    .filter((l) => !l.isNpp)
    .sort(byDesc((l) => l.marketCapAnchor ?? l.marketCap))
    .slice(0, 5);
  const topBonds = (bonds.data?.bonds ?? [])
    .filter((b) => b.issuerType !== "sovereign" && !b.defaulted && b.publicFloat > 0)
    .sort(byDesc((b) => b.yieldToMaturity))
    .slice(0, 5);
  const topFunds = [...(funds.data?.funds ?? [])].sort(byDesc((f) => f.aumAnchor)).slice(0, 5);
  const movers = [...(commodities ?? [])]
    .sort(byDesc((c) => Math.abs(vsBasePct(c) ?? 0)))
    .slice(0, 5);
  const sectorRows = (sectors?.sectors ?? []).slice(0, 5);
  const offerRows = (offers?.offers ?? []).slice(0, 5);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <PreviewCard
        title="Stocks"
        detail="Largest by market cap"
        href="/market?tab=stocks"
        loading={stocks.loading}
        error={stocks.error}
        empty={topStocks.length === 0}
      >
        {topStocks.map((l) => (
          <PreviewRow
            key={l._id}
            href={`/corporation/${l.sequentialId}`}
            left={
              <span className="flex min-w-0 items-center gap-2">
                <CorporationLogo
                  logoUrl={l.logoUrl}
                  name={l.name}
                  size="h-5 w-5"
                  className="rounded"
                />
                <span className="truncate">{`${l.tickerSymbol ? `${l.tickerSymbol} ` : ""}${l.name}`}</span>
              </span>
            }
            right={`${formatListingPrice(l.sharePrice, l.liquidCurrencyCode as CurrencyCode | null | undefined)} ${pctText(l.priceChange24h)}`}
            rightTone={toneClass(l.priceChange24h)}
          />
        ))}
      </PreviewCard>
      <PreviewCard
        title="Bonds"
        detail="Highest yield with units available"
        href="/market?tab=bonds"
        loading={bonds.loading}
        error={bonds.error}
        empty={topBonds.length === 0}
      >
        {topBonds.map((b) => (
          <PreviewRow
            key={b._id}
            href={`/corporation/${b.corporationSequentialId ?? b.corporationId}`}
            left={`${b.corporationName} ${b.maturityLabel}`}
            right={`${b.yieldToMaturity.toFixed(2)}%`}
          />
        ))}
      </PreviewCard>
      <PreviewCard
        title="Funds"
        detail="Largest by assets"
        href="/market?tab=funds"
        loading={funds.loading}
        error={funds.error}
        empty={topFunds.length === 0}
      >
        {topFunds.map((f) => (
          <PreviewRow
            key={f.id}
            href={`/country/global/stockmarket/fund/${f.slug}`}
            left={`${f.tickerSymbol} ${f.name}`}
            right={pctText(f.navChange24)}
            rightTone={toneClass(f.navChange24)}
          />
        ))}
      </PreviewCard>
      <PreviewCard
        title="Sectors for sale"
        detail={`${sectors?.totalItems ?? 0} listed`}
        href="/market?tab=sectors"
        loading={loading}
        error=""
        empty={sectorRows.length === 0}
      >
        {sectorRows.map((s) => (
          <PreviewRow
            key={s.id}
            href={
              s.corporationId
                ? `/corporation/${s.corporationSequentialId ?? s.corporationId}/sector/${s.id}`
                : "/sectors"
            }
            left={`${s.sectorTypeLabel}, ${s.stateName}`}
            right={s.forSalePrice != null ? formatAmount(s.forSalePrice) : "n/a"}
          />
        ))}
      </PreviewCard>
      <PreviewCard
        title="Commodities"
        detail="Furthest from base price"
        href="/market?tab=commodities"
        loading={loading}
        error=""
        empty={movers.length === 0}
      >
        {movers.map((c) => (
          <PreviewRow
            key={c.commodity}
            href={`/commodity/${c.commodity}`}
            left={c.label}
            right={pctText(vsBasePct(c))}
            rightTone={toneClass(vsBasePct(c))}
          />
        ))}
      </PreviewCard>
      <PreviewCard
        title="Supply deals"
        detail={`${offers?.total ?? 0} open`}
        href="/market?tab=supply"
        loading={loading}
        error=""
        empty={offerRows.length === 0}
      >
        {offerRows.map((o) => (
          <PreviewRow
            key={o.id}
            left={
              <span className="flex min-w-0 items-center gap-2">
                <CorporationLogo
                  logoUrl={o.corporationLogoUrl}
                  name={o.corporationName}
                  size="h-5 w-5"
                  className="rounded"
                />
                <span className="truncate">{`${COMMODITY_LABELS[o.commodity]} ${o.side === "sell" ? "offered" : "sought"} by ${o.corporationName}${o.ai ? " (NPP)" : ""}`}</span>
              </span>
            }
            right={pctText(o.pricePremium * 100)}
            rightTone={toneClass(-o.pricePremium)}
          />
        ))}
      </PreviewCard>
    </div>
  );
}
