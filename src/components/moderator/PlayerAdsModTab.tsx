"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

interface AdRow {
  _id: string;
  characterName: string;
  countryId: string;
  imageUrl: string;
  linkUrl: string | null;
  altText: string | null;
  viewCount: number;
  isActive: boolean;
  createdAt: string;
  costPaid: number;
  currencyCode: string;
}

function fmt(n: number, code: string) {
  return `${n.toLocaleString("en-US")} ${code}`;
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor(diff / 3_600_000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "just now";
}

export function PlayerAdsModTab() {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetchAds(0, false);
  }, []);

  async function fetchAds(offset: number, append: boolean) {
    try {
      const url = new URL("/api/moderator/player-ads", window.location.origin);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", "25");

      const res = await fetch(url.toString());
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        if (append) {
          setAds((prev) => [...prev, ...data.ads]);
        } else {
          setAds(data.ads);
        }
        setHasMore(data.hasMore ?? false);
      }
    } catch {
      setError("Failed to load ads.");
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }

  async function removeAd(id: string) {
    setActionError("");
    if (!window.confirm("Permanently remove this ad? This cannot be undone.")) return;
    try {
      await fetchJson(`/api/moderator/player-ads/${id}`, {
        method: "DELETE",
        feature: "moderator-player-ads",
      });
    } catch {
      setActionError("Failed to remove ad.");
      return;
    }
    setAds((prev) => prev.filter((a) => a._id !== id));
  }

  async function toggleAdActive(id: string, currentActive: boolean) {
    setActionError("");
    setToggling(id);
    try {
      const res = await fetch(`/api/moderator/player-ads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });

      if (!res.ok) {
        setActionError("Failed to toggle ad.");
        return;
      }

      setAds((prev) => prev.map((a) => (a._id === id ? { ...a, isActive: !a.isActive } : a)));
    } catch {
      setActionError("Failed to toggle ad.");
    } finally {
      setToggling(null);
    }
  }

  function handleLoadMore() {
    setLoadingMore(true);
    fetchAds(ads.length, true);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-info border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-error py-4">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Player Banner Ads</h3>
          <p className="mt-0.5 text-xs text-muted">
            {ads.length} ad{ads.length !== 1 ? "s" : ""} total ·{" "}
            {ads.filter((a) => a.isActive).length} active
          </p>
        </div>
      </div>

      {actionError && <p className="text-sm text-error">{actionError}</p>}

      {ads.length === 0 ? (
        <p className="text-sm text-muted py-4">No player ads have been submitted yet.</p>
      ) : (
        <>
          <div className="space-y-3">
            {ads.map((ad) => (
              <div
                key={ad._id}
                className={`rounded-xl border p-4 space-y-3 ${
                  ad.isActive
                    ? "border-card-border bg-card"
                    : "border-card-border/50 bg-card/60 opacity-70"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Thumbnail */}
                  <a
                    href={ad.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ad.imageUrl}
                      alt={ad.altText ?? `Ad by ${ad.characterName}`}
                      className="rounded border border-card-border object-contain bg-background/50"
                      style={{ width: 200, height: 56, objectFit: "contain" }}
                    />
                  </a>

                  {/* Meta */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{ad.characterName}</p>
                      <span className="text-xs text-muted">({ad.countryId})</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          ad.isActive ? "bg-success/15 text-success" : "bg-muted/15 text-muted"
                        }`}
                      >
                        {ad.isActive ? "Active" : "Paused"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>{ad.viewCount.toLocaleString("en-US")} views</span>
                      <span>Cost paid: {fmt(ad.costPaid, ad.currencyCode)}</span>
                      <span>Submitted {relativeDate(ad.createdAt)}</span>
                    </div>
                    {ad.linkUrl && (
                      <div className="mt-2 pt-2 border-t border-card-border">
                        <p className="text-xs text-muted mb-1">Link:</p>
                        <a
                          href={ad.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline break-all"
                        >
                          <code className="bg-background/50 px-2 py-1 rounded">{ad.linkUrl}</code>
                        </a>
                      </div>
                    )}
                    {ad.altText && (
                      <p className="text-xs text-muted truncate mt-1">Alt: {ad.altText}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleAdActive(ad._id, ad.isActive)}
                      disabled={toggling === ad._id}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        ad.isActive
                          ? "border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-50"
                          : "border-success/30 text-success hover:bg-success/10 disabled:opacity-50"
                      }`}
                    >
                      {toggling === ad._id ? "Updating…" : ad.isActive ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeAd(ad._id)}
                      className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full rounded-xl border border-card-border bg-card py-3 text-sm text-muted transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
