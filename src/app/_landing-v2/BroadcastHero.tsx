"use client";

/**
 * Hero chrome for the broadcast lander (the 1991 world): a news kicker over the
 * headline, a crawl of the year's headlines along the foot of the first
 * viewport, and the blue ground glow the globe sits in. The globe's own art is
 * in `components/landing/broadcastGlobe`.
 *
 * Signal red is deliberately off the brand palette, the same way the 1953 CRT
 * green is: it belongs to the broadcast, not to the site. Nothing here uses a
 * backdrop blur: it all sits over a globe that repaints every frame, and a
 * blur there is recomputed on each of them.
 */
import { useEffect, useState, type CSSProperties } from "react";
import {
  BACKGROUND_MACRO_COLOR,
  TIER_COLORS,
  TIER_LABELS,
  TIER_ORDER,
} from "@/components/landing/countryTiers";
import type { BroadcastTickerItem } from "@/components/landing/eraThemes";

/** The kicker reads as one strip: a red block, then the dateline on smoked glass. */
export function BroadcastKicker({ kicker, dateline }: { kicker: string; dateline: string }) {
  return (
    <p className="mb-5 inline-flex items-stretch overflow-hidden rounded-[3px] font-mono text-[0.66rem] font-semibold uppercase leading-none tracking-[0.2em] shadow-[0_10px_30px_-14px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
      <span className="flex items-center gap-2 bg-[#e5172f] px-2.5 py-2 text-white">
        <span aria-hidden="true" className="h-1.5 w-1.5 bg-white" />
        {kicker}
      </span>
      <span className="flex items-center bg-[#070b16]/85 px-2.5 py-2 text-white/75">
        {dateline}
      </span>
    </p>
  );
}

/** Sans, tight and heavy, with the era's year picked out in signal red. */
export function BroadcastHeadline({
  text,
  year,
  currentYear,
}: {
  text: string;
  /** The era's seed year, as written in `text`. */
  year: number;
  /** The world's year now. The headline rolls from `year` up to it. */
  currentYear?: number;
}) {
  const written = String(year);
  const at = text.lastIndexOf(written);
  return (
    <h1 className="ahd-bc-headline text-balance text-[2.35rem] font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-[2.75rem] lg:text-[2.95rem]">
      {at < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <YearOdometer from={year} to={Math.max(year, currentYear ?? year)} />
          {text.slice(at + written.length)}
        </>
      )}
    </h1>
  );
}

/** How long the page shows the seed year before rolling to the world's year. */
const ODOMETER_HOLD_MS = 900;

/**
 * The year as an odometer: the page loads on the seed year (1991) and each
 * digit rolls to the year the world has reached, so a world in its fourth year
 * turns its last digit up three places to 1994. Screen readers get the settled
 * year once; the rolling digits are hidden from them. Reduced motion settles
 * straight away, and the CSS drops the roll.
 */
export function YearOdometer({ from, to }: { from: number; to: number }) {
  const [shown, setShown] = useState(from);

  useEffect(() => {
    if (to === from) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShown(to), reduce ? 0 : ODOMETER_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [from, to]);

  return (
    <span className="ahd-bc-odometer text-[#ff4d5e]">
      <span className="sr-only">{to}</span>
      <span aria-hidden="true" className="inline-flex">
        {String(shown)
          .split("")
          .map((digit, place, all) => (
            <span key={place} className="ahd-bc-odometer-digit">
              {/* The 0 to 9 strip is drawn by CSS, so the headline's text stays
                  the year alone for search engines and copy and paste. */}
              <span
                className="ahd-bc-odometer-strip"
                style={{
                  transform: `translateY(${-Number(digit) * 10}%)`,
                  // Lower places start first, the way an odometer carries.
                  transitionDelay: `${(all.length - 1 - place) * 70}ms`,
                }}
              />
            </span>
          ))}
      </span>
    </span>
  );
}

/**
 * Lower-third crawl. Two identical runs inside one track that slides by half
 * its width, so the loop seams invisibly. Hover or focus pauses it, and reduced
 * motion stops it and lets the run scroll by hand instead.
 */
export function BroadcastTicker({
  label,
  items,
}: {
  label: string;
  items: readonly BroadcastTickerItem[];
}) {
  const characters = items.reduce((sum, item) => sum + item.date.length + item.text.length, 0);
  // Constant reading speed, about 70px a second at this size, whatever the count.
  const style = {
    "--ahd-bc-crawl-dur": `${Math.max(40, Math.round(characters * 0.1))}s`,
  } as CSSProperties;

  const run = (copy: "read" | "echo") => (
    <ul className="flex shrink-0 items-center" aria-hidden={copy === "echo" ? true : undefined}>
      {items.map((item) => (
        <li key={`${item.date} ${item.text}`} className="flex items-center whitespace-nowrap">
          <span className="font-mono text-[0.68rem] font-semibold tracking-[0.14em] text-[#ff7380]">
            {item.date}
          </span>
          <span className="ml-2.5 text-[0.72rem] font-medium tracking-[0.07em] text-white/90">
            {item.text}
          </span>
          <span aria-hidden="true" className="mx-5 h-1 w-1 shrink-0 bg-[#ff4d5e]" />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ahd-bc-ticker pointer-events-auto flex h-9 items-stretch overflow-hidden rounded-[4px] border border-white/10 bg-[#050a18]/90 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.95)]">
      <span className="flex shrink-0 items-center gap-2 bg-[#e5172f] px-3 font-mono text-[0.7rem] font-bold tracking-[0.2em] text-white">
        {label}
      </span>
      <div className="ahd-bc-crawl-window relative min-w-0 flex-1 overflow-hidden">
        <div className="ahd-bc-crawl flex w-max items-center uppercase" style={style}>
          {run("read")}
          {run("echo")}
        </div>
      </div>
    </div>
  );
}

/**
 * The globe's four tiers as one row over the crawl. The globe's own corner key
 * would sit on top of the ticker, so this lander draws its key here instead.
 * It fades with the hero copy while the idle showcase is running.
 */
export function BroadcastTierKey({
  hidden,
  backgroundIsSimulated,
}: {
  hidden: boolean;
  /** Background Nations are the macro-simulated ones, drawn in their own colour. */
  backgroundIsSimulated: boolean;
}) {
  return (
    <ul
      aria-hidden="true"
      className={`mb-2.5 hidden flex-wrap justify-end gap-x-5 gap-y-1.5 transition-opacity duration-500 sm:flex ${
        hidden ? "opacity-0" : "opacity-90"
      }`}
    >
      {TIER_ORDER.map((tier) => (
        <li key={tier} className="inline-flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{
              background:
                tier === "background" && backgroundIsSimulated
                  ? BACKGROUND_MACRO_COLOR
                  : TIER_COLORS[tier],
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
            {TIER_LABELS[tier]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Blue ground glow under the globe, in place of the CRT phosphor field. */
export function BroadcastBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(circle at 60% 48%, rgba(37, 99, 235, 0.18), rgba(37, 99, 235, 0.05) 34%, transparent 56%)",
      }}
    />
  );
}
