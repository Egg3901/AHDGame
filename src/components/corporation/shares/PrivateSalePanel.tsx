"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { LocalTime } from "@/components/time/LocalTime";
import type { CorporationDetail } from "../CorporationPageTypes";
import { apiErrorText } from "@/lib/errors/catalog";

interface ShareOfferData {
  _id: string;
  buyerCharacterId: string;
  buyerName: string;
  buyerSequentialId?: number;
  shares: number;
  pricePerShare: number;
  escrowAmount: number;
  isMyOffer: boolean;
  createdAt: string;
}

interface ShareListingData {
  _id: string;
  sellerCharacterId: string;
  sellerName: string;
  sellerSequentialId?: number;
  sharesListed: number;
  sharesRemaining: number;
  marketPriceAtCreation: number;
  priceFloor: number;
  priceCeiling: number;
  expiresAt: string;
  isMySelling: boolean;
  offerCount: number;
  offers: ShareOfferData[];
}

interface PrivateSalePanelProps {
  corporation: CorporationDetail;
  myCharacterId: string | null;
  corpId: string;
  myShares: number;
  /** Whether the viewer is the current CEO of this corporation — gates the divest-confirm dialog. */
  isCeo?: boolean;
  onToast: (message: string, variant: "success" | "error") => void;
  /** When true, renders inline without the accordion card — always expanded */
  forceOpen?: boolean;
}

export default function PrivateSalePanel({
  corporation,
  myCharacterId,
  corpId,
  myShares,
  isCeo = false,
  onToast,
  forceOpen = false,
}: PrivateSalePanelProps) {
  const {
    toDisplay,
    toInternal,
    toInternalFrom,
    toLocalOf,
    inputSymbol,
    formatPrice: fmtPrice,
    formatFull: fmtFull,
  } = useCurrency();
  // Option B: offer.escrowAmount lands in the listing corp's liquidCurrencyCode
  // (matches the parent corporation for this panel). Normalize to ₳ for the
  // wallet-pref-aware formatter.
  const corpCurrencyCode = corporation.liquidCurrencyCode as
    import("@/lib/constants/currencies").CurrencyCode | undefined;
  // sharePrice is redacted for non-CEO viewers of a private corp (buyer view);
  // listings carry their own floor/ceiling so the offer form still works.
  const sharePrice = corporation.sharePrice ?? 0;
  const escrowToAnchor = (local: number) =>
    corpCurrencyCode ? toInternalFrom(local, corpCurrencyCode) : local;
  // corporation.sharePrice / offer.pricePerShare / listing.marketPriceAtCreation
  // are all stored in target local (Task-18A + Option B). Wrap fmtPrice so we
  // always normalize local → ₳ before the wallet-aware formatter.
  const fmtLocalPrice = (local: number) =>
    fmtPrice(corpCurrencyCode ? toInternalFrom(local, corpCurrencyCode) : local, corpCurrencyCode);

  const [open, setOpen] = useState(forceOpen);
  const [listings, setListings] = useState<ShareListingData[]>([]);
  const [loading, setLoading] = useState(false);

  // Create listing form
  const [listingShares, setListingShares] = useState(0);
  const [ceoVacateConfirm, setCeoVacateConfirm] = useState<{ message: string } | null>(null);

  // Submit offer forms — keyed by listingId
  const [offerShares, setOfferShares] = useState<Record<string, number>>({});
  const [offerPrice, setOfferPrice] = useState<Record<string, number>>({});

  // Accept partial amount — keyed by offerId
  const [acceptAmounts, setAcceptAmounts] = useState<Record<string, number>>({});

  const loadListings = useCallback(async () => {
    const res = await fetch(`/api/corporations/${corpId}/shares/listings`);
    if (!res.ok) return;
    const data = await res.json();
    setListings(data.listings ?? []);
  }, [corpId]);

  useEffect(() => {
    if (open) void loadListings();
  }, [open, loadListings]);

  const handleCreateListing = async (confirmVacate = false) => {
    if (listingShares <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares: listingShares,
          ...(confirmVacate ? { confirmCeoVacate: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.requiresCeoVacateConfirm) {
          setCeoVacateConfirm({
            message: apiErrorText(
              data,
              "Listing all your shares will remove you as CEO. Continue?"
            ),
          });
          return;
        }
        onToast(apiErrorText(data, "Failed to create listing"), "error");
      } else {
        setCeoVacateConfirm(null);
        onToast(
          `Listed ${listingShares.toLocaleString("en-US")} shares for private sale`,
          "success"
        );
        setListingShares(0);
        await loadListings();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelListing = async (listingId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/listings/${listingId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(apiErrorText(data, "Failed to cancel listing"), "error");
      } else {
        onToast("Listing cancelled and shares returned", "success");
        await loadListings();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitOffer = async (listingId: string) => {
    const shares = offerShares[listingId] ?? 0;
    const price = offerPrice[listingId] ?? 0;
    if (shares <= 0 || price <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/listings/${listingId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares,
          // Server stores pricePerShare in the listing corp's liquidCurrencyCode
          // (Option B). Convert the display-currency input to that target local.
          pricePerShare: corpCurrencyCode ? toLocalOf(price, corpCurrencyCode) : toInternal(price),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(apiErrorText(data, "Failed to submit offer"), "error");
      } else {
        onToast(
          `Offer submitted. ${fmtFull(escrowToAnchor(data.escrowAmount))} in escrow.`,
          "success"
        );
        setOfferShares((prev) => ({ ...prev, [listingId]: 0 }));
        setOfferPrice((prev) => ({ ...prev, [listingId]: 0 }));
        await loadListings();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawOffer = async (listingId: string, offerId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/shares/listings/${listingId}/offers/${offerId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast(apiErrorText(data, "Failed to withdraw offer"), "error");
      } else {
        onToast("Offer withdrawn and escrow refunded", "success");
        await loadListings();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptOffer = async (listingId: string, offerId: string, maxShares: number) => {
    const sharesToAccept = acceptAmounts[offerId] ?? maxShares;
    if (sharesToAccept <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/shares/listings/${listingId}/offers/${offerId}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sharesToAccept }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast(apiErrorText(data, "Failed to accept offer"), "error");
      } else {
        onToast(
          `Accepted ${data.sharesTransferred.toLocaleString("en-US")} shares. ${fmtFull(data.proceeds)} received.`,
          "success"
        );
        await loadListings();
      }
    } finally {
      setLoading(false);
    }
  };

  const myListings = listings.filter((l) => l.isMySelling);
  const otherListings = listings.filter((l) => !l.isMySelling);

  const innerContent = (
    <div className={forceOpen ? "space-y-4" : "space-y-4 pt-2"}>
      {/* Create listing — only shown if you own shares */}
      {myCharacterId && myShares > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted">List your shares</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-muted mb-1">Shares to list</label>
              <input
                type="number"
                value={listingShares || ""}
                onChange={(e) => setListingShares(Math.max(0, Math.floor(Number(e.target.value))))}
                placeholder="Quantity"
                min={1}
                max={myShares}
                className="h-7 w-36 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
              />
            </div>
            <button
              onClick={() => void handleCreateListing()}
              disabled={loading || listingShares <= 0}
              className="inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Listing" : "Create listing"}
            </button>
          </div>
          {sharePrice > 0 && (
            <p className="mt-2 text-xs text-muted">
              Current market: {fmtLocalPrice(sharePrice)} · Buyers may offer{" "}
              {fmtLocalPrice(sharePrice * 0.5)} to {fmtLocalPrice(sharePrice * 2.0)}
            </p>
          )}
          {isCeo && listingShares > 0 && listingShares === myShares && (
            <p className="mt-2 text-xs text-error">
              You are the CEO. Listing all {myShares.toLocaleString("en-US")} of your remaining
              shares will remove you as CEO, and you would need to be re-appointed. You will be
              asked to confirm first.
            </p>
          )}
        </div>
      )}

      {ceoVacateConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-warning/40 bg-card p-5 shadow-modal space-y-3">
            <h3 className="text-sm font-semibold text-foreground">This will remove you as CEO</h3>
            <p className="text-xs leading-relaxed text-muted">{ceoVacateConfirm.message}</p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setCeoVacateConfirm(null)}
                disabled={loading}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:bg-card-elevated disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateListing(true)}
                disabled={loading}
                className="rounded-lg bg-error px-3 py-1.5 text-xs font-medium text-white hover:bg-error/90 disabled:opacity-50"
              >
                {loading ? "Listing" : "List and step down"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Your active listings (seller view) */}
      {myListings.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted">Your listings</h3>
          <div>
            {myListings.map((listing) => (
              <div key={listing._id} className="border-b border-card-border/60 py-2">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {listing.sharesRemaining.toLocaleString("en-US")} shares remaining
                    </span>
                    <span className="text-xs text-muted ml-2">
                      of {listing.sharesListed.toLocaleString("en-US")} listed
                    </span>
                    <div className="text-xs text-muted mt-0.5">
                      Offer range:{" "}
                      <span className="text-foreground">
                        {fmtLocalPrice(listing.priceFloor)} to {fmtLocalPrice(listing.priceCeiling)}
                      </span>
                      {" · "}Expires{" "}
                      <LocalTime
                        value={listing.expiresAt}
                        options={{ hour: "2-digit", minute: "2-digit" }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelListing(listing._id)}
                    disabled={loading}
                    className="text-xs text-error hover:text-error/80 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>

                {listing.offers.length === 0 ? (
                  <p className="text-xs text-muted">No offers yet</p>
                ) : (
                  <div className="divide-y divide-card-border/50">
                    {listing.offers.map((offer) => {
                      const maxAccept = Math.min(offer.shares, listing.sharesRemaining);
                      const inputVal = acceptAmounts[offer._id] ?? maxAccept;
                      return (
                        <div key={offer._id} className="py-1.5 pl-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {offer.buyerSequentialId ? (
                                  <Link
                                    href={`/character/${offer.buyerSequentialId}`}
                                    className="truncate text-xs font-medium text-foreground hover:underline"
                                  >
                                    {offer.buyerName}
                                  </Link>
                                ) : (
                                  <span className="text-xs font-medium text-foreground">
                                    {offer.buyerName}
                                  </span>
                                )}
                                <span className="text-xs text-muted">
                                  {offer.shares.toLocaleString("en-US")} @{" "}
                                  {fmtLocalPrice(offer.pricePerShare)}
                                </span>
                                <span className="text-xs font-medium tabular-nums text-foreground">
                                  = {fmtFull(Math.round(escrowToAnchor(offer.escrowAmount)))}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                value={inputVal || ""}
                                onChange={(e) =>
                                  setAcceptAmounts((prev) => ({
                                    ...prev,
                                    [offer._id]: Math.min(
                                      maxAccept,
                                      Math.max(1, Math.floor(Number(e.target.value)))
                                    ),
                                  }))
                                }
                                min={1}
                                max={maxAccept}
                                className="h-6 w-24 rounded border border-card-border bg-background px-1.5 text-right text-xs tabular-nums text-foreground focus:border-foreground focus:outline-none"
                              />
                              <button
                                onClick={() => handleAcceptOffer(listing._id, offer._id, maxAccept)}
                                disabled={loading}
                                className="inline-flex h-6 items-center rounded border border-primary bg-primary px-2 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Accept
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other open listings (buyer view) */}
      {otherListings.length > 0 && myCharacterId && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted">Open listings</h3>
          <div>
            {otherListings.map((listing) => {
              const myExistingOffer = listing.offers.find((o) => o.isMyOffer);
              return (
                <div key={listing._id} className="border-b border-card-border/60 py-2">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      {listing.sellerSequentialId ? (
                        <Link
                          href={`/character/${listing.sellerSequentialId}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {listing.sellerName}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium text-foreground">
                          {listing.sellerName}
                        </span>
                      )}
                      <span className="ml-2 text-sm text-foreground">
                        selling {listing.sharesRemaining.toLocaleString("en-US")} shares
                      </span>
                      <div className="text-xs text-muted mt-0.5">
                        Offer range:{" "}
                        <span className="text-foreground">
                          {fmtLocalPrice(listing.priceFloor)} to{" "}
                          {fmtLocalPrice(listing.priceCeiling)}
                        </span>
                        {" · "}
                        {listing.offerCount} offer
                        {listing.offerCount !== 1 ? "s" : ""}
                        {" · "}Expires{" "}
                        <LocalTime
                          value={listing.expiresAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* My existing offer */}
                  {myExistingOffer && (
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-foreground">
                        Your offer: {myExistingOffer.shares.toLocaleString("en-US")} @{" "}
                        {fmtLocalPrice(myExistingOffer.pricePerShare)} (
                        {fmtFull(Math.round(escrowToAnchor(myExistingOffer.escrowAmount)))}{" "}
                        escrowed)
                      </span>
                      <button
                        onClick={() => handleWithdrawOffer(listing._id, myExistingOffer._id)}
                        disabled={loading}
                        className="text-xs text-error hover:text-error/80 disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    </div>
                  )}

                  {/* Submit offer form */}
                  {!myExistingOffer && (
                    <div className="flex items-end gap-3 flex-wrap">
                      <div>
                        <label className="block text-xs text-muted mb-1">Shares</label>
                        <input
                          type="number"
                          value={offerShares[listing._id] || ""}
                          onChange={(e) =>
                            setOfferShares((prev) => ({
                              ...prev,
                              [listing._id]: Math.min(
                                listing.sharesRemaining,
                                Math.max(0, Math.floor(Number(e.target.value)))
                              ),
                            }))
                          }
                          placeholder="Quantity"
                          min={1}
                          max={listing.sharesRemaining}
                          className="h-7 w-28 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">
                          Price/share ({inputSymbol})
                        </label>
                        <input
                          type="number"
                          value={offerPrice[listing._id] || ""}
                          onChange={(e) =>
                            setOfferPrice((prev) => ({
                              ...prev,
                              [listing._id]: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          placeholder={`${toDisplay(
                            corpCurrencyCode
                              ? toInternalFrom(listing.priceFloor, corpCurrencyCode)
                              : listing.priceFloor
                          ).toFixed(4)} to ${toDisplay(
                            corpCurrencyCode
                              ? toInternalFrom(listing.priceCeiling, corpCurrencyCode)
                              : listing.priceCeiling
                          ).toFixed(4)}`}
                          min={toDisplay(
                            corpCurrencyCode
                              ? toInternalFrom(listing.priceFloor, corpCurrencyCode)
                              : listing.priceFloor
                          )}
                          max={toDisplay(
                            corpCurrencyCode
                              ? toInternalFrom(listing.priceCeiling, corpCurrencyCode)
                              : listing.priceCeiling
                          )}
                          step={0.0001}
                          className="h-7 w-36 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => handleSubmitOffer(listing._id)}
                        disabled={loading || !offerShares[listing._id] || !offerPrice[listing._id]}
                        className="inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loading ? "Submitting" : "Make offer"}
                      </button>
                    </div>
                  )}

                  {(offerShares[listing._id] ?? 0) > 0 &&
                    (offerPrice[listing._id] ?? 0) > 0 &&
                    !myExistingOffer && (
                      <div className="mt-2 text-xs text-muted">
                        Escrow:{" "}
                        <span className="text-foreground font-medium">
                          {fmtFull(
                            Math.round(
                              (offerShares[listing._id] ?? 0) *
                                toInternal(offerPrice[listing._id] ?? 0)
                            )
                          )}
                        </span>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {listings.length === 0 && (
        <p className="py-1 text-xs text-muted">No open private listings for this corporation.</p>
      )}
    </div>
  );

  if (forceOpen) {
    return innerContent;
  }

  return (
    <section className="min-w-0">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-card-border pb-1.5">
        <h2 className="flex min-w-0 items-baseline gap-2 text-sm font-semibold text-foreground">
          Private sale
          <span className="text-xs font-normal text-muted">
            listings expire after 24 hours; offers run 50% to 200% of market
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-7 items-center rounded-md border border-card-border px-2.5 text-xs font-medium text-foreground hover:bg-card-elevated"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && innerContent}
    </section>
  );
}
