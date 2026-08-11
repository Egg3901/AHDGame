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
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: string;
  costPaid: number;
  currencyCode: string;
}

const MODERATION_BADGE: Record<AdRow["moderationStatus"], { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-warning/15 text-warning" },
  approved: { label: "Approved", className: "bg-success/15 text-success" },
  rejected: { label: "Rejected", className: "bg-error/15 text-error" },
};

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

export function PlayerBannerAdsTab() {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    fetch("/api/admin/player-ads")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAds(data.ads as AdRow[]);
      })
      .catch(() => setError("Failed to load ads."))
      .finally(() => setLoading(false));
  }, []);

  async function toggleActive(id: string, next: boolean) {
    setActionError("");
    try {
      await fetchJson(`/api/admin/player-ads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
        feature: "admin-player-ads",
      });
    } catch {
      setActionError("Failed to update ad status.");
      return;
    }
    setAds((prev) => prev.map((a) => (a._id === id ? { ...a, isActive: next } : a)));
  }

  async function setModeration(id: string, status: AdRow["moderationStatus"]) {
    setActionError("");
    try {
      await fetchJson(`/api/admin/player-ads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moderationStatus: status }),
        feature: "admin-player-ads",
      });
    } catch {
      setActionError("Failed to update moderation status.");
      return;
    }
    setAds((prev) => prev.map((a) => (a._id === id ? { ...a, moderationStatus: status } : a)));
  }

  async function removeAd(id: string) {
    setActionError("");
    if (!window.confirm("Permanently remove this ad? This cannot be undone.")) return;
    try {
      await fetchJson(`/api/admin/player-ads/${id}`, {
        method: "DELETE",
        feature: "admin-player-ads",
      });
    } catch {
      setActionError("Failed to remove ad.");
      return;
    }
    setAds((prev) => prev.filter((a) => a._id !== id));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
            {ads.filter((a) => a.isActive).length} active ·{" "}
            {ads.filter((a) => a.moderationStatus === "pending").length} pending review
          </p>
        </div>
      </div>

      {actionError && <p className="text-sm text-error">{actionError}</p>}

      {ads.length === 0 ? (
        <p className="text-sm text-muted py-4">No player ads have been submitted yet.</p>
      ) : (
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
                  {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied ad URL, not whitelisted for Next/Image */}
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
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${MODERATION_BADGE[ad.moderationStatus].className}`}
                    >
                      {MODERATION_BADGE[ad.moderationStatus].label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{ad.viewCount.toLocaleString("en-US")} views</span>
                    <span>Cost paid: {fmt(ad.costPaid, ad.currencyCode)}</span>
                    <span>Submitted {relativeDate(ad.createdAt)}</span>
                  </div>
                  {ad.linkUrl && (
                    <p className="text-xs text-muted truncate">
                      Link:{" "}
                      <a
                        href={ad.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {ad.linkUrl}
                      </a>
                    </p>
                  )}
                  {ad.altText && <p className="text-xs text-muted truncate">Alt: {ad.altText}</p>}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 gap-2">
                  {ad.moderationStatus !== "approved" && (
                    <button
                      type="button"
                      onClick={() => void setModeration(ad._id, "approved")}
                      className="rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/15"
                    >
                      Approve
                    </button>
                  )}
                  {ad.moderationStatus !== "rejected" && (
                    <button
                      type="button"
                      onClick={() => void setModeration(ad._id, "rejected")}
                      className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10"
                    >
                      Reject
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleActive(ad._id, !ad.isActive)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      ad.isActive
                        ? "border-card-border text-muted hover:border-primary/40 hover:text-foreground"
                        : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                    }`}
                  >
                    {ad.isActive ? "Pause" : "Restore"}
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
      )}
    </div>
  );
}
