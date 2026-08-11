import type { ReactNode } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { NationalSeal } from "./NationalSeal";
import { AuthoritySeal, type NationalRole } from "./AuthoritySeal";
import { hexToRgba } from "./identityColor";

interface NationalMastheadProps {
  country: CountryId;
  role?: NationalRole;
  /**
   * Optional stat strip rendered under the banner — pass `HeroStatsStrip`
   * children (public-instrument metrics), or omit for a bare masthead.
   */
  statStrip?: ReactNode;
  /** Extra badges/pills rendered in the banner badge row. */
  children?: ReactNode;
  /**
   * Distinct corporation name for a split-off division. Surfaced under the
   * national-identity title so a split-off (e.g. "… — Energy Division") is not
   * visually identical to the primary National Corporation. Omit for the primary.
   */
  divisionName?: string;
  className?: string;
}

const SERIF_CJK = "'Noto Serif SC', 'Noto Serif JP', 'Songti SC', serif";
const SERIF_MONO = "'Playfair Display', Georgia, 'Times New Roman', serif";

/**
 * The State Masthead — the National Corporation hero banner. Deliberately NOT a
 * market header: no share price, no market cap. Foregrounds the corp as an
 * instrument of the state (seal chop, registry eyebrow, role stamp).
 *
 * The banner gradient + accent are the country's fixed brand identity; the card
 * frame, rule, and any stat strip inherit `ahd-design-system` tokens so the
 * masthead stays theme-native. Pass `statStrip` to attach a `HeroStatsStrip`.
 */
export function NationalMasthead({
  country,
  role = "public",
  statStrip,
  children,
  divisionName,
  className = "",
}: NationalMastheadProps) {
  const id = getNationalIdentity(country);
  const serif = id.serif === "cjk" ? SERIF_CJK : SERIF_MONO;
  const bannerBg = `radial-gradient(120% 140% at 0% 0%, ${hexToRgba(id.accent, 0.14)} 0%, transparent 42%), linear-gradient(135deg, ${id.palette[0]} 0%, ${id.palette[1]} 46%, ${id.palette[2]} 100%)`;

  return (
    <header
      className={`overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg ${className}`}
    >
      {/* Banner */}
      <div
        className="relative overflow-hidden px-5 pt-5 pb-4 sm:px-7 sm:pt-6"
        style={{ background: bannerBg }}
      >
        {/* Faint watermark glyph */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-10 select-none font-black leading-none"
          style={{ fontSize: 240, fontFamily: serif, color: hexToRgba(id.accentSoft, 0.06) }}
        >
          {id.glyph}
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <NationalSeal country={country} size={76} />

          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: hexToRgba(id.accentSoft, 0.8) }}
            >
              {id.registry}
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {id.name}
            </h1>
            <div
              className="mt-0.5 flex flex-wrap items-center gap-2 text-base"
              style={{ fontFamily: serif, color: hexToRgba(id.accentSoft, 0.92) }}
            >
              {id.native}
            </div>
            {divisionName && (
              <div className="mt-1.5 text-lg font-semibold text-white/95">{divisionName}</div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold text-white"
                style={{
                  borderColor: hexToRgba(id.accent, 0.45),
                  background: hexToRgba(id.accent, 0.16),
                }}
              >
                National Corporation
              </span>
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium"
                style={{
                  borderColor: hexToRgba(id.accent, 0.5),
                  background: hexToRgba(id.accent, 0.1),
                  color: id.accentSoft,
                }}
              >
                Wholly state-owned
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-black/30 px-2.5 py-0.5 text-xs font-medium text-white/80">
                HQ {id.hqCity}
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/60">
                Not listed · No tradable equity
              </span>
              {children}
            </div>
          </div>

          {/* Role stamp */}
          <div className="hidden shrink-0 sm:block">
            <AuthoritySeal country={country} role={role} size={86} />
          </div>
        </div>
      </div>

      {/* Accent rule (country brand line) */}
      <div
        className="h-0.5"
        style={{
          background: `linear-gradient(90deg, transparent, ${id.accent} 18%, ${id.accentSoft} 50%, ${id.accent} 82%, transparent)`,
          opacity: 0.85,
        }}
      />

      {statStrip}
    </header>
  );
}
