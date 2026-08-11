"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { SECTOR_FOR_SALE_PRICE_FRACTION } from "@/lib/constants/corporations";
import type { SectorData, CorporationRef, ForSaleInfo } from "../types";

interface ForSalePanelProps {
  sector: SectorData;
  corporation: CorporationRef;
  isCeo: boolean;
  forSaleInfo: ForSaleInfo | null;
  listing: boolean;
  unlisting: boolean;
  buying: boolean;
  message: { type: "error" | "success"; text: string } | null;
  onList: () => void;
  onUnlist: () => void;
  onBuy: () => void;
}

const DISCOUNT_PCT = Math.round((1 - SECTOR_FOR_SALE_PRICE_FRACTION) * 100);
const PRICE_PCT = Math.round(SECTOR_FOR_SALE_PRICE_FRACTION * 100);

export default function ForSalePanel({
  sector,
  corporation,
  isCeo,
  forSaleInfo,
  listing,
  unlisting,
  buying,
  message,
  onList,
  onUnlist,
  onBuy,
}: ForSalePanelProps) {
  const { formatAmount } = useCurrency();
  const [confirmList, setConfirmList] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const sellerCurrency = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const isListed = !!sector.forSale;

  // ── Buyer view ────────────────────────────────────────────────────────────
  if (!isCeo && isListed && forSaleInfo) {
    const buyerCurrency =
      (forSaleInfo.viewerLiquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
    const fundWarning = !forSaleInfo.hasFunds
      ? `Need ${formatAmount(sector.forSale!.priceAnchor, buyerCurrency)} to purchase. You have ${formatAmount(forSaleInfo.viewerCapitalAnchor, buyerCurrency)}.`
      : null;

    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-success">
            For Sale
          </span>
          <h3 className="text-sm font-semibold text-foreground">Buy this sector</h3>
        </div>
        <p className="mt-2 text-xs text-muted">
          The seller is offering this sector at {PRICE_PCT}% of its estimated worth, which is what
          its future profits are worth today. That is {DISCOUNT_PCT}% off. The asking price was
          fixed when the listing went up.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted">Asking price</div>
            <div className="text-base font-bold text-foreground tabular-nums">
              {formatAmount(sector.forSale!.priceAnchor, buyerCurrency)}
            </div>
          </div>
          <div>
            <div className="text-muted">Estimated worth at listing</div>
            <div className="text-sm tabular-nums text-foreground">
              {formatAmount(sector.forSale!.npvAnchor, buyerCurrency)}
            </div>
          </div>
        </div>
        {message && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              message.type === "error"
                ? "border-error/30 bg-error/10 text-error"
                : "border-success/30 bg-success/10 text-success"
            }`}
          >
            {message.text}
          </div>
        )}
        {forSaleInfo.conflict && (
          <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
            You already operate this sector type in {sector.stateName}. Purchasing will merge the
            acquired sector&apos;s revenue and workers into your existing one.
          </div>
        )}
        {fundWarning ? (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            {fundWarning}
          </div>
        ) : null}
        <div className="mt-4">
          {confirmBuy ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                {forSaleInfo.conflict ? (
                  <>
                    Merge this sector into your existing one for{" "}
                    <strong>{formatAmount(sector.forSale!.priceAnchor, buyerCurrency)}</strong>?
                    Revenue and workers will be combined. Funds come from your corporation&apos;s
                    treasury.
                  </>
                ) : (
                  <>
                    Buy this sector for{" "}
                    <strong>{formatAmount(sector.forSale!.priceAnchor, buyerCurrency)}</strong>?
                    Funds come from your corporation&apos;s treasury.
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmBuy(false);
                    onBuy();
                  }}
                  disabled={buying || !forSaleInfo.eligible}
                  className="flex-1 rounded-lg border border-success/40 bg-success px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {buying
                    ? forSaleInfo.conflict
                      ? "Merging…"
                      : "Buying…"
                    : forSaleInfo.conflict
                      ? "Confirm Merge"
                      : "Confirm Purchase"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBuy(false)}
                  disabled={buying}
                  className="rounded-lg border border-card-border px-3 py-2 text-sm font-medium text-muted hover:bg-card-elevated"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmBuy(true)}
              disabled={!forSaleInfo.eligible || buying}
              className="w-full rounded-lg border border-success/30 bg-success/10 px-4 py-2 text-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                fundWarning ??
                (forSaleInfo.conflict ? "Merge into your existing sector" : "Buy this sector")
              }
            >
              {forSaleInfo.conflict ? "Buy & Merge Sector" : "Buy Sector"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Seller view (CEO only) ─────────────────────────────────────────────────
  if (!isCeo) return null;

  if (isListed && sector.forSale) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-success">
            Listed
          </span>
          <h3 className="text-sm font-semibold text-foreground">
            For Sale on the secondary market
          </h3>
        </div>
        <p className="mt-2 text-xs text-muted">
          Other CEOs can purchase this sector from their corporation treasury. The listing price is
          locked at posting and won&apos;t change as the sector&apos;s profit fluctuates.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted">Asking price</div>
            <div className="text-base font-bold text-foreground tabular-nums">
              {formatAmount(sector.forSale.priceAnchor, sellerCurrency)}
            </div>
          </div>
          <div>
            <div className="text-muted">Estimated worth at listing</div>
            <div className="text-sm tabular-nums text-foreground">
              {formatAmount(sector.forSale.npvAnchor, sellerCurrency)}
            </div>
          </div>
        </div>
        {message && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              message.type === "error"
                ? "border-error/30 bg-error/10 text-error"
                : "border-success/30 bg-success/10 text-success"
            }`}
          >
            {message.text}
          </div>
        )}
        <button
          type="button"
          onClick={onUnlist}
          disabled={unlisting}
          className="mt-4 w-full rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {unlisting ? "Unlisting…" : "Unlist Sector"}
        </button>
      </div>
    );
  }

  // ── Seller, not listed yet — show "List for sale" CTA ─────────────────────
  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">List Sector for Sale</h3>
          <p className="mt-1 text-xs text-muted">
            Sell this sector to another CEO at {PRICE_PCT}% of its estimated worth, which is what
            its future profits are worth today. The money goes straight to your corporation
            treasury.
          </p>
        </div>
        {!confirmList && (
          <button
            type="button"
            onClick={() => setConfirmList(true)}
            disabled={listing}
            className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            List for Sale
          </button>
        )}
      </div>
      {message && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            message.type === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {message.text}
        </div>
      )}
      {confirmList && (
        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <p className="text-sm text-foreground">
            List this sector at <strong>{PRICE_PCT}%</strong> of its estimated worth, a{" "}
            {DISCOUNT_PCT}% discount? You can unlist at any time.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmList(false);
                onList();
              }}
              disabled={listing}
              className="flex-1 rounded-lg border border-primary/40 bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {listing ? "Listing…" : "Confirm Listing"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmList(false)}
              disabled={listing}
              className="rounded-lg border border-card-border px-3 py-2 text-sm font-medium text-muted hover:bg-card-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
