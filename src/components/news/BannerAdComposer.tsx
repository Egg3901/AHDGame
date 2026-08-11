"use client";

import { useEffect, useRef, useState } from "react";

interface CostInfo {
  cost: number;
  currencyCode: string;
  balance: number;
  affordable: boolean;
  canSubmit: boolean;
  turnsUntilEligible: number | null;
}

function fmt(n: number, code: string) {
  return `${n.toLocaleString("en-US")} ${code}`;
}

function turnLabel(turns: number): string {
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

interface BannerAdComposerProps {
  onClose?: () => void;
}

export function BannerAdComposer({ onClose }: BannerAdComposerProps) {
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
      .catch(() => setInfoError("Failed to load pricing info."));
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

  if (submitted) {
    return (
      <div className="py-6 text-center space-y-2">
        <p className="text-base font-semibold text-foreground">Banner ad submitted!</p>
        <p className="text-sm text-muted">
          Your banner is now live and will display across eligible pages.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {/* Cost info row */}
      <div className="rounded-lg border border-card-border bg-background/60 px-3 py-2.5 text-sm">
        {infoError ? (
          <p className="text-error text-xs">{infoError}</p>
        ) : !info ? (
          <p className="text-muted text-xs">Loading pricing…</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-muted text-xs">
              Cost:{" "}
              <span className="font-semibold text-foreground">
                {fmt(info.cost, info.currencyCode)}
              </span>
            </span>
            <span className={`text-xs ${info.affordable ? "text-muted" : "text-error"}`}>
              Balance: <span className="font-semibold">{fmt(info.balance, info.currencyCode)}</span>
            </span>
            <span className="text-muted text-xs">
              Eligible:{" "}
              <span className="font-semibold text-foreground">
                {info.turnsUntilEligible && info.turnsUntilEligible > 0
                  ? `In ${turnLabel(info.turnsUntilEligible)}`
                  : "Now"}
              </span>
            </span>
          </div>
        )}
        <p className="mt-1 text-[10px] text-muted">
          Cost = 25% of average personal balance · 1 submission per 24 turns · rotates by view count
        </p>
      </div>

      {/* Image upload */}
      <div>
        <p className="text-xs text-muted mb-1.5">
          JPEG, PNG, WebP, or GIF · max 2 MB · displayed at up to 970×250
        </p>
        <div
          className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-background/50 px-4 py-6 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview from user-supplied data URL; Next/Image can't handle blob/data URLs cleanly
            <img
              src={preview}
              alt="Preview"
              className="max-w-full rounded object-contain"
              style={{ maxHeight: 120 }}
            />
          ) : (
            <>
              <svg
                className="h-7 w-7 text-muted mb-1.5"
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
              <p className="text-xs text-muted">Click to select banner image</p>
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
          <p className="mt-1 text-[10px] text-muted">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      {/* Optional link */}
      <div>
        <label htmlFor="bannerLinkUrl" className="block text-xs font-medium text-foreground mb-1">
          Click-through URL <span className="text-muted font-normal">(optional — https://)</span>
        </label>
        <input
          id="bannerLinkUrl"
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Optional alt text */}
      <div>
        <label htmlFor="bannerAltText" className="block text-xs font-medium text-foreground mb-1">
          Alt text <span className="text-muted font-normal">(optional)</span>
        </label>
        <input
          id="bannerAltText"
          type="text"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          maxLength={200}
          placeholder="Vote for the Liberty Party!"
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Agreement */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-card-border accent-primary"
        />
        <span className="text-xs text-muted leading-relaxed">
          I confirm this image complies with content guidelines. Policy violations result in removal
          without refund.
        </span>
      </label>

      {submitError && <p className="text-xs text-error">{submitError}</p>}

      {info && !info.affordable && (
        <p className="text-xs text-error">
          Insufficient balance — need {fmt(info.cost, info.currencyCode)}, have{" "}
          {fmt(info.balance, info.currencyCode)}.
        </p>
      )}
      {info?.turnsUntilEligible != null && info.turnsUntilEligible > 0 && (
        <p className="text-xs text-muted">
          Rate limited — next submission in {turnLabel(info.turnsUntilEligible)}.
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
            ? `Submit banner · ${fmt(info.cost, info.currencyCode)}`
            : "Submit banner"}
      </button>
    </form>
  );
}
