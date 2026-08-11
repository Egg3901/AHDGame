"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { EconomicVerdict } from "@/lib/economy/outlook";
import { budgetUrl } from "@/lib/urls";

interface EconomyMastheadProps {
  countryId: string;
  identity: EconomyIdentity;
  currentTurn: number;
  /** Display-side outlook verdict; null hides the seal + reasoning bar. */
  verdict: EconomicVerdict | null;
  reasoning: string | null;
  /** The pulse strip rendered beneath the accent rule. */
  strip: ReactNode;
}

/**
 * National-accounts masthead for the Economic Outlook page — the economy
 * sibling of `StatMasthead` (Metrics) and `TreasuryMasthead` (Budget). Same
 * anatomy: always-dark banner with scoped per-country accent vars, watermark
 * glyph, square chop, registry/title/office lines, badge row, rotated round
 * seal (here carrying the outlook verdict), control bar (verdict reasoning),
 * accent rule, then the headline stat strip supplied by the caller.
 */
export function EconomyMasthead({
  countryId,
  identity,
  currentTurn,
  verdict,
  reasoning,
  strip,
}: EconomyMastheadProps) {
  const { accent } = identity;
  const isCjk = identity.serif === "cjk";
  const accentVars = {
    "--stat": accent.stat,
    "--stat-soft": accent.statSoft,
    "--g0": accent.g0,
    "--g1": accent.g1,
    "--g2": accent.g2,
  } as CSSProperties;
  const mastheadBg =
    "radial-gradient(120% 150% at 0% 0%, color-mix(in srgb, var(--stat-soft) 16%, transparent) 0%, transparent 44%), linear-gradient(135deg, var(--g0) 0%, var(--g1) 52%, var(--g2) 100%)";

  return (
    <header
      data-testid="economy-masthead"
      className="relative overflow-hidden rounded-2xl border bg-card shadow-lg"
      style={{
        ...accentVars,
        borderColor: "color-mix(in srgb, var(--stat) 25%, transparent)",
        boxShadow:
          "0 0 0 1px color-mix(in srgb, var(--stat) 25%, transparent), 0 12px 34px -14px color-mix(in srgb, var(--stat) 45%, transparent)",
      }}
    >
      <div className="relative px-5 pb-4 pt-5 sm:px-7 sm:pt-6" style={{ background: mastheadBg }}>
        {/* watermark glyph */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-12 select-none font-black"
          style={{
            fontSize: 200,
            lineHeight: 1,
            color: "color-mix(in srgb, var(--stat-soft) 6%, transparent)",
            fontFamily: "var(--font-serif), serif",
          }}
        >
          {identity.glyph}
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* chop */}
          <div
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-lg font-black ${isCjk ? "font-serif" : "font-mono"}`}
            style={{
              width: 76,
              height: 76,
              fontSize: isCjk ? 38 : identity.glyph.length >= 3 ? 20 : 26,
              color: "var(--stat-soft)",
              background:
                "linear-gradient(160deg, color-mix(in srgb, var(--g0) 70%, white 8%), var(--g1))",
              border: "2px solid var(--stat)",
              boxShadow:
                "inset 0 0 0 1px color-mix(in srgb, var(--stat-soft) 32%, transparent), 0 4px 14px rgba(0,0,0,0.5)",
            }}
          >
            {identity.glyph}
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: "color-mix(in srgb, var(--stat-soft) 80%, transparent)" }}
            >
              {identity.registry}
            </div>
            <h1
              className={`mt-1.5 text-2xl font-bold leading-[1.1] tracking-tight text-white sm:text-3xl ${isCjk ? "font-serif" : ""}`}
            >
              {identity.title}
              {identity.titleEn && (
                <span className="ml-2 align-middle text-lg font-semibold text-white/55 sm:text-xl">
                  ({identity.titleEn})
                </span>
              )}
            </h1>
            <div
              className="mt-0.5 flex items-center gap-2 text-sm"
              style={{ color: "color-mix(in srgb, var(--stat-soft) 90%, transparent)" }}
            >
              {identity.office}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{
                  borderColor: "color-mix(in srgb, var(--stat) 40%, transparent)",
                  background: "color-mix(in srgb, var(--stat) 25%, transparent)",
                }}
              >
                National rollup
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-0.5 text-xs font-medium text-white/80">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                Live · Turn {currentTurn}
              </span>
              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-white/10 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/60">
                Public record
              </span>
              {/* On <sm the rotated seal is hidden — the verdict folds into the badge row */}
              {verdict && (
                <span
                  className="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] sm:hidden"
                  style={{
                    borderColor: "color-mix(in srgb, var(--stat) 55%, transparent)",
                    background: "color-mix(in srgb, var(--stat) 10%, transparent)",
                    color: "color-mix(in srgb, var(--stat) 92%, white)",
                  }}
                >
                  {verdict}
                </span>
              )}
              <Link
                href={budgetUrl(countryId)}
                className="inline-flex items-center whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                National Budget &rarr;
              </Link>
            </div>
          </div>

          {/* rotated verdict seal */}
          {verdict && (
            <div className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
              <div
                className="flex items-center justify-center rounded-full border-2 text-center font-mono text-[11px] font-bold tracking-[0.08em]"
                style={{
                  width: 84,
                  height: 84,
                  transform: "rotate(-11deg)",
                  borderColor: "color-mix(in srgb, var(--stat) 70%, transparent)",
                  color: "color-mix(in srgb, var(--stat) 92%, white)",
                  padding: 8,
                  boxShadow: "inset 0 0 0 2px color-mix(in srgb, var(--stat) 22%, transparent)",
                }}
              >
                {verdict}
              </div>
              <span
                className="text-[8px] font-bold uppercase tracking-[0.16em]"
                style={{ color: "color-mix(in srgb, var(--stat-soft) 55%, transparent)" }}
              >
                economic outlook
              </span>
            </div>
          )}
        </div>

        {/* control bar: verdict reasoning */}
        {verdict && reasoning && (
          <div className="relative mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 pt-3.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
              Verdict
            </span>
            <span className="text-[11.5px] text-white/65">{reasoning}</span>
          </div>
        )}
      </div>

      {/* accent rule */}
      <div
        style={{
          height: 2,
          opacity: 0.85,
          background:
            "linear-gradient(90deg, transparent, var(--stat) 16%, var(--stat-soft) 50%, var(--stat) 84%, transparent)",
        }}
      />

      {strip}
    </header>
  );
}

export default EconomyMasthead;
