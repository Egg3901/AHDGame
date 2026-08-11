"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui";

interface CostInfo {
  cost: number;
  currencyCode: string;
  balance: number;
  affordable: boolean;
  canSubmit: boolean;
  isFree: boolean;
  freeUsed: number;
  freeLimit: number;
  turnsUntilEligible: number | null;
  tier: "supporter" | "supporter-plus" | "supporter-plus-plus" | null;
  isPatronActive: boolean;
}

const GUIDELINES = [
  "No explicit sexual content or nudity.",
  "No harassment, threats, or content targeting specific players.",
  "No hate speech or discriminatory imagery.",
  "No use of copyrighted logos, trademarked characters, or protected brand assets you do not own.",
  "No misleading, scam, or fraudulent content.",
  "No external links to harmful, phishing, or malware sites.",
  "No referencing real-world political figures in a defamatory manner.",
  "Content must be related to your in-game activity (faction, party, corporation, campaign, etc.).",
  "New ads are reviewed by an admin before they start serving, and may be removed without refund for policy violations.",
];

function fmt(n: number, code: string) {
  return `${n.toLocaleString("en-US")} ${code}`;
}

function turnLabel(turns: number): string {
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

export function PlayerAdsClient() {
  const [info, setInfo] = useState<CostInfo | null>(null);
  const [infoError, setInfoError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/player-ads")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setInfoError(data.error);
        else setInfo(data as CostInfo);
      })
      .catch(() => setInfoError("Failed to load pricing info. Please sign in."));
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !agreed || !info?.canSubmit) return;

    setSubmitting(true);
    setSubmitError("");

    const form = new FormData();
    form.append("file", file);
    if (linkUrl.trim()) form.append("linkUrl", linkUrl.trim());
    if (altText.trim()) form.append("altText", altText.trim());

    try {
      const res = await fetch("/api/player-ads", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Submission failed.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Place a Banner Ad</h1>
          <p className="mt-2 text-sm text-muted">
            Promote your party, faction, or corporation across high-traffic public pages. Ads
            display indefinitely and rotate in order of lowest view count until equalised.
          </p>
        </div>

        {/* Pricing card */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-6 space-y-3">
          <h2 className="text-base font-semibold">Pricing</h2>
          {infoError ? (
            <p className="text-sm text-error">{infoError}</p>
          ) : !info ? (
            <div className="grid min-h-[62px] grid-cols-2 gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="space-y-1.5 rounded-lg border border-card-border/60 bg-background/50 px-3 py-2"
                >
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {info.isPatronActive ? (
                <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 mb-3">
                  <p className="text-sm font-medium text-primary">
                    {info.tier === "supporter-plus-plus"
                      ? "Supporter++ Benefits Active"
                      : info.tier === "supporter-plus"
                        ? "Supporter+ Benefits Active"
                        : "Supporter Benefits Active"}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {info.isFree
                      ? `This ad is free! (${info.freeUsed}/${info.freeLimit} used)`
                      : `All free ads used. Next free ad in ${turnLabel(info.turnsUntilEligible ?? 0)}.`}
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-lg border border-card-border/60 bg-background/50 px-3 py-2">
                  <p className="text-xs text-muted mb-0.5">Ad cost</p>
                  <p className="font-semibold text-foreground">
                    {info.isFree ? "Free" : fmt(info.cost, info.currencyCode)}
                  </p>
                </div>
                <div className="rounded-lg border border-card-border/60 bg-background/50 px-3 py-2">
                  <p className="text-xs text-muted mb-0.5">Your balance</p>
                  <p
                    className={`font-semibold ${info.affordable ? "text-foreground" : "text-error"}`}
                  >
                    {fmt(info.balance, info.currencyCode)}
                  </p>
                </div>
                <div className="rounded-lg border border-card-border/60 bg-background/50 px-3 py-2">
                  <p className="text-xs text-muted mb-0.5">Next eligible</p>
                  <p className="font-semibold text-foreground">
                    {info.turnsUntilEligible && info.turnsUntilEligible > 0
                      ? `In ${turnLabel(info.turnsUntilEligible)}`
                      : "Now"}
                  </p>
                </div>
              </div>
            </>
          )}
          <p className="text-xs text-muted">
            Cost = 2% of average personal balance. Supporters get 1 free ad per 72 turns, Supporter+
            gets 2 free ads per 48 turns.
          </p>
        </div>

        {/* Guidelines */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-6">
          <h2 className="text-base font-semibold mb-3">Content Guidelines</h2>
          <p className="text-sm text-muted mb-3">
            Every ad is reviewed by an admin before it starts serving. Violations are rejected or
            removed without refund and may lead to account penalties.
          </p>
          <ul className="space-y-1.5">
            {GUIDELINES.map((g) => (
              <li key={g} className="flex items-start gap-2 text-sm text-muted">
                <span className="mt-[3px] shrink-0 h-1.5 w-1.5 rounded-full bg-primary/60" />
                {g}
              </li>
            ))}
          </ul>
        </div>

        {/* Upload form */}
        {submitted ? (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center">
            <p className="text-lg font-semibold text-foreground mb-1">Ad submitted!</p>
            <p className="text-sm text-muted">
              Your banner is now live and will display on eligible pages alongside other ads. View
              counts will equalise over time as it rotates in.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => void onSubmit(e)}
            className="rounded-xl border border-card-border bg-card p-5 sm:p-6 space-y-5"
          >
            <h2 className="text-base font-semibold">Upload Your Banner</h2>

            {/* Image upload */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Banner image <span className="text-error">*</span>
              </label>
              <p className="text-xs text-muted mb-2">
                JPEG, PNG, WebP, or GIF · max 2 MB · resized to fit 970×250
              </p>
              <div
                className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-background/50 px-4 py-8 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview from user-supplied data URL; Next/Image can't handle blob/data URLs cleanly
                  <img
                    src={preview}
                    alt="Preview"
                    className="max-w-full rounded object-contain"
                    style={{ maxHeight: 160 }}
                  />
                ) : (
                  <>
                    <svg
                      className="h-8 w-8 text-muted mb-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <p className="text-sm text-muted">Click to select an image</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>
              {file && (
                <p className="mt-1 text-xs text-muted">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>

            {/* Optional link */}
            <div>
              <label htmlFor="linkUrl" className="block text-sm font-medium text-foreground mb-1">
                Click-through URL{" "}
                <span className="text-muted font-normal">(optional — must be https://)</span>
              </label>
              <input
                id="linkUrl"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Alt text */}
            <div>
              <label htmlFor="altText" className="block text-sm font-medium text-foreground mb-1">
                Alt text{" "}
                <span className="text-muted font-normal">(optional — describes the image)</span>
              </label>
              <input
                id="altText"
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                maxLength={200}
                placeholder="Vote for the Liberty Party!"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Agreement */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-card-border accent-primary"
              />
              <span className="text-sm text-muted leading-relaxed">
                I confirm that this image complies with the content guidelines above, and I
                understand that policy violations result in removal without refund.
              </span>
            </label>

            {submitError && <p className="text-sm text-error">{submitError}</p>}

            {info && !info.affordable && (
              <p className="text-sm text-error">
                Insufficient balance. You need {fmt(info.cost, info.currencyCode)} but have{" "}
                {fmt(info.balance, info.currencyCode)}.
              </p>
            )}
            {info?.turnsUntilEligible != null && info.turnsUntilEligible > 0 && (
              <p className="text-sm text-muted">
                Rate limit active. You can submit again in {turnLabel(info.turnsUntilEligible)}.
              </p>
            )}

            <button
              type="submit"
              disabled={!file || !agreed || !info?.canSubmit || submitting}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Uploading…"
                : info
                  ? info.isFree
                    ? "Submit free ad"
                    : `Submit ad · ${fmt(info.cost, info.currencyCode)}`
                  : "Submit ad"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
