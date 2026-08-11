"use client";

import type { ReactNode } from "react";
import { HeroImage } from "@/components/HeroImage";
import type { CountryId } from "@/lib/constants/countries";
import type { InstitutionIdentity } from "@/lib/constants/institutionIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import { InstitutionSeal } from "@/components/national/InstitutionSeal";
import { hexToRgba } from "@/components/national/identityColor";

const SERIF_CJK = "'Noto Serif SC', 'Noto Serif JP', 'Songti SC', serif";
const SERIF_MONO = "'Playfair Display', Georgia, 'Times New Roman', serif";

export interface InstitutionMastheadProps {
  countryId: CountryId;
  identity: InstitutionIdentity;
  /** Real-world seal image; falls back to the generated seal when absent. */
  sealImage?: ExecutiveSeal | null;
  /** Optional hero photo fused above the band, fading into the brand gradient. */
  heroImage?: { src: string; alt: string } | null;
  /** Chip row under the title. */
  chips?: ReactNode;
  /** Right-aligned stat slot (label + headline number). */
  rightSlot?: ReactNode;
  /** Fused strip below the band (e.g. stat tiles). */
  strip?: ReactNode;
}

/**
 * Shared institution masthead — the Executive / National Policy / Central
 * Bank counterpart of `TreasuryMasthead`, same identity grammar: optional
 * photo hero → brand-gradient band (watermark glyph, NationalSeal, registry
 * eyebrow, serif title) → optional fused tile strip. Banner gradient + accent
 * are the institution's fixed brand colors (the documented raw-value
 * exception); everything else inherits semantic tokens.
 */
export function InstitutionMasthead({
  countryId,
  identity: id,
  sealImage,
  heroImage,
  chips,
  rightSlot,
  strip,
}: InstitutionMastheadProps) {
  const serif = id.serif === "cjk" ? SERIF_CJK : SERIF_MONO;
  const bannerBg = `radial-gradient(120% 160% at 0% 0%, ${hexToRgba(id.accent, 0.14)} 0%, transparent 42%), linear-gradient(135deg, ${id.palette[0]} 0%, ${id.palette[1]} 46%, ${id.palette[2]} 100%)`;

  return (
    <header className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      {heroImage && (
        <div className="relative h-[150px] w-full sm:h-[185px]">
          <HeroImage
            src={heroImage.src}
            alt={heroImage.alt}
            fill
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
          />
          {/* Photo fades into the band's brand gradient (Executive pattern). */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, ${hexToRgba(id.palette[0], 0.92)}, rgba(0,0,0,0.25) 65%, transparent)`,
            }}
          />
        </div>
      )}

      <div
        className={`relative overflow-hidden px-5 pb-4 pt-5 sm:px-7 ${heroImage ? "border-t border-white/10" : ""}`}
        style={{ background: bannerBg }}
      >
        {/* Faint watermark glyph */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-3 -top-14 select-none font-black leading-none"
          style={{ fontSize: 200, fontFamily: serif, color: hexToRgba(id.accentSoft, 0.06) }}
        >
          {id.glyph}
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <InstitutionSeal
            country={countryId}
            glyph={id.glyph}
            serif={id.serif}
            accent={id.accent}
            sealImage={sealImage}
            size={64}
          />

          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: hexToRgba(id.accentSoft, 0.8) }}
            >
              {id.registry}
            </div>
            <h1 className="mt-1 text-xl font-bold leading-[1.1] tracking-tight text-white sm:text-2xl">
              <span style={{ fontFamily: serif }}>{id.title}</span>
              {id.titleEn && (
                <span className="ml-2 align-middle text-base font-semibold text-white/55 sm:text-lg">
                  {id.titleEn}
                </span>
              )}
            </h1>
            {chips && <div className="mt-2.5 flex flex-wrap items-center gap-2">{chips}</div>}
          </div>

          {rightSlot && <div className="shrink-0 text-right">{rightSlot}</div>}
        </div>
      </div>

      {/* Accent rule (brand line) */}
      <div
        aria-hidden
        className="h-0.5"
        style={{
          background: `linear-gradient(90deg, transparent, ${id.accent} 18%, ${id.accentSoft} 50%, ${id.accent} 82%, transparent)`,
          opacity: 0.85,
        }}
      />

      {strip}
    </header>
  );
}

/** Standard masthead chip — bordered pill on the band gradient. */
export function MastheadChip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "mono";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/50 bg-success/15 text-success"
      : tone === "warning"
        ? "border-warning/50 bg-warning/15 text-warning"
        : tone === "mono"
          ? "border-white/15 text-white/60 font-mono"
          : "border-white/25 text-white/85";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClass}`}
    >
      {children}
    </span>
  );
}

/** Right-slot stat for the masthead (small label + headline number). */
export function MastheadStat({
  label,
  value,
  accentSoft,
}: {
  label: string;
  value: ReactNode;
  accentSoft: string;
}) {
  return (
    <div>
      <div
        className="text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: hexToRgba(accentSoft, 0.6) }}
      >
        {label}
      </div>
      <div className="font-mono text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
