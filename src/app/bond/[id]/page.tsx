"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import BackButton from "@/components/BackButton";
import { getExchangeForCountry } from "@/lib/constants/exchangeRegistry";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondDetail, BondUserContext, PricePoint, Holder } from "./components/bondTypes";
import { BondHeroPanel } from "./components/BondHeroPanel";
import { BondMyHoldingsPanel } from "./components/BondMyHoldingsPanel";
import { BondOwnersSection } from "./components/BondOwnersSection";
import { BondBuybackPanel } from "./components/BondBuybackPanel";
import { BondTradeModal } from "./components/BondTradeModal";
import { BondPriceChart } from "./components/BondPriceChart";

export default function BondDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [bond, setBond] = useState<BondDetail | null>(null);
  const [userContext, setUserContext] = useState<BondUserContext | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [autoConvertEnabled, setAutoConvertEnabled] = useState(true);
  const { formatAmount, toInternalFrom } = useCurrency();

  const fetchBondDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/bonds/${id}`);
      const json = await res.json();
      if (res.ok) {
        setBond(json.bond);
        setUserContext(json.user ?? null);
        if (json.user?.autoConvertEnabled !== undefined) {
          setAutoConvertEnabled(json.user.autoConvertEnabled);
        }
        setHistory(json.priceHistory || []);
        setHolders(json.holders || []);
      } else {
        setError(json.error || "Failed to load bond");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBondDetail();
  }, [fetchBondDetail]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16 pt-8">
        <div className="mx-auto max-w-5xl px-4 space-y-6">
          <Skeleton className="h-[220px] w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !bond) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Bond Not Found</h1>
          <p className="text-muted">{error || "This bond does not exist."}</p>
          <BackButton />
        </div>
      </div>
    );
  }

  // A country with no configured venue links to the global market rather than
  // claiming a NYSE listing it does not have.
  const exchangeName = bond.countryId ? getExchangeForCountry(bond.countryId) : undefined;
  const exchange = exchangeName ? bond.countryId! : "global";
  const exchangeLabel = exchangeName ?? "Global";
  const corpHref = bond.corporationSequentialId
    ? `/corporation/${bond.corporationSequentialId}`
    : null;
  const isCeo = userContext?.isCeo ?? false;
  const hasHoldings =
    (userContext?.myBondUnits ?? 0) > 0 || (userContext?.myCorporation?.bondUnits ?? 0) > 0;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
        {/* ─── Breadcrumb ──────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          <Link
            href={`/stockmarket/${exchange}?tab=bonds`}
            className="hover:text-foreground transition-colors"
          >
            {exchangeLabel}
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/stockmarket/${exchange}?tab=bonds`}
            className="hover:text-foreground transition-colors"
          >
            Bonds
          </Link>
          <span aria-hidden>/</span>
          {corpHref ? (
            <Link
              href={corpHref}
              className="hover:text-foreground transition-colors truncate max-w-[160px]"
            >
              {bond.corporationName}
            </Link>
          ) : (
            <span className="truncate max-w-[160px]">{bond.corporationName}</span>
          )}
          <span aria-hidden>/</span>
          <span className="text-foreground font-medium">Series {bond.maturityLabel}</span>
        </nav>

        {/* ─── Hero Panel ──────────────────────────────────────────────── */}
        <BondHeroPanel
          bond={bond}
          yieldToMaturity={bond.yieldToMaturity}
          corpHref={corpHref}
          onTrade={
            !bond.matured && userContext?.myCharacterId ? () => setShowTradeModal(true) : undefined
          }
        />

        {/* ─── My Holdings ─────────────────────────────────────────────── */}
        {userContext?.myCharacterId && hasHoldings && (
          <BondMyHoldingsPanel userContext={userContext} bond={bond} />
        )}

        {/* ─── Price Chart ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-4">Price History</h2>
          {history.length < 2 ? (
            <div className="flex items-center justify-center h-[180px] text-muted text-sm border border-dashed border-card-border rounded-lg bg-card-elevated/30">
              Not enough price history yet.
            </div>
          ) : (
            <BondPriceChart data={history} />
          )}
        </div>

        {/* ─── Ownership Distribution ──────────────────────────────────── */}
        {(holders.length > 0 || bond.publicFloat > 0) && (
          <BondOwnersSection
            holders={holders}
            publicFloat={bond.publicFloat}
            totalUnits={bond.totalUnits}
            marketPrice={bond.pricePerUnit}
          />
        )}

        {/* ─── Bond Details ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
            Bond Details
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            {[
              // Bond money fields (totalIssued, perTurnCoupon, totalInterestPaid)
              // denominate in `bond.currencyCode` post-v0.2.6. Normalize to ₳ + pass
              // the code so formatAmount honors wallet-pref display.
              ...(() => {
                const bondCode = (bond.currencyCode ??
                  (bond.countryId
                    ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
                    : undefined)) as CurrencyCode | undefined;
                const fmtBond = (val: number) => {
                  const anchor = bondCode ? toInternalFrom(val, bondCode) : val;
                  return formatAmount(anchor, bondCode);
                };
                return [
                  { label: "Total Issued", value: fmtBond(bond.totalIssued) },
                  { label: "Total Units", value: bond.totalUnits.toLocaleString("en-US") },
                  {
                    label: "Public Float",
                    value: `${bond.publicFloat.toLocaleString("en-US")} (${bond.publicFloatPercentage.toFixed(1)}%)`,
                  },
                  { label: "Issued At Turn", value: `T${bond.issuedAtTurn}` },
                  { label: "Matures At Turn", value: `T${bond.maturityTurn}` },
                  { label: "Coupon / Turn", value: fmtBond(bond.perTurnCoupon) },
                  { label: "Total Interest Paid", value: fmtBond(bond.totalInterestPaid) },
                ];
              })(),
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{label}</span>
                <span className="font-medium tabular-nums text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── CEO: Retire Debt ────────────────────────────────────────── */}
        {isCeo && bond.publicFloat > 0 && !bond.matured && (
          <BondBuybackPanel bond={bond} bondId={id} onSuccess={fetchBondDetail} />
        )}
      </main>

      {/* ─── Trade Modal ─────────────────────────────────────────────────── */}
      {showTradeModal && bond && userContext && (
        <BondTradeModal
          bond={bond}
          bondId={id}
          userContext={userContext}
          autoConvertEnabled={autoConvertEnabled}
          onAutoConvertChange={setAutoConvertEnabled}
          onClose={() => setShowTradeModal(false)}
          onSuccess={() => {
            setShowTradeModal(false);
            void fetchBondDetail();
          }}
        />
      )}
    </div>
  );
}
