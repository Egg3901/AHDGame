"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { createPortal } from "react-dom";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { ActionType } from "@/lib/db/types/gameState";
import type { CharacterRecap, RecapRankedStat } from "@/lib/recap/types";

/**
 * Season Recap ("Wrapped") — a full-screen, tap-through recap of a character's
 * just-ended political life. Art direction: an "election-night / official
 * record" aesthetic — curated duotone grounds, ballot-cream + brass-gold accents,
 * oversized ghost category words, certificate corner-ticks, film grain, and a
 * count-up on every headline number. Deliberately a single immersive world
 * (not the app's chrome tokens). Reused by the post-reset gate and history
 * re-watch. Respects prefers-reduced-motion.
 */

const SLIDE_MS = 5400;
const GOLD = "#E8B84B";
const CREAM = "#F5F1E6";

/** Curated deep duotone grounds — color varies per slide (Wrapped-style), while
 * the treatment (gold, cream, ghost word, framing) stays cohesive. */
const GROUNDS = [
  "linear-gradient(155deg,#0B1E3B 0%,#14417a 100%)", // federal navy
  "linear-gradient(155deg,#3A0B1E 0%,#7a1230 100%)", // oxblood
  "linear-gradient(155deg,#06231C 0%,#0c5a43 100%)", // forest
  "linear-gradient(155deg,#241033 0%,#5a1a6b 100%)", // aubergine
  "linear-gradient(155deg,#331708 0%,#8a3b12 100%)", // umber
  "linear-gradient(155deg,#052A2E 0%,#0a6b6b 100%)", // deep teal
  "linear-gradient(155deg,#1A0B33 0%,#3b1a8a 100%)", // indigo
];
const FINALE_GROUND = "linear-gradient(155deg,#120d05 0%,#281f0a 55%,#463610 100%)";

/** Themed emoji that rain down behind each slide (celebratory, per the subject). */
const DEFAULT_EMOJI = ["🗳️", "🏛️", "📊", "⭐", "📈"];
const SLIDE_EMOJI: Record<string, string[]> = {
  intro: ["🗳️", "🏛️", "📜", "⭐"],
  actions: ["📣", "⚡", "💪", "📈", "🔥"],
  office: ["🏛️", "🎖️", "👔", "🗽"],
  ballot: ["🗳️", "✅", "📮", "🎗️"],
  clout: ["📈", "🔥", "⭐", "💥"],
  favor: ["💛", "👍", "🙂", "🌟"],
  wealth: ["💰", "💵", "🪙", "💎"],
  law: ["📜", "⚖️", "🖋️", "📖"],
  wire: ["📰", "📣", "💬", "🗞️"],
  honors: ["🏆", "🎖️", "🥇", "✨"],
};
const FINALE_EMOJI = ["🎉", "🎊", "✨", "⭐", "🗳️", "🏆"];

/** Subtle film-grain overlay (inline SVG turbulence). */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const ACTION_LABELS: Record<ActionType, string> = {
  fundraise: "Fundraising",
  campaign: "Campaigning",
  advertise: "Advertising",
  buildDonorBase: "Building donors",
  poll: "Polling",
  pollLarge: "Deep polling",
  convertCash: "Moving money",
  rest: "Resting",
  debatePrep: "Debate prep",
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmt(n);
}
function currencySymbolFor(countryId: string): string {
  const code = COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD";
  const s: Record<string, string> = {
    USD: "$",
    GBP: "£",
    EUR: "€",
    JPY: "¥",
    CNY: "¥",
    BRL: "R$",
    RUB: "₽",
    TRY: "₺",
    SEK: "kr",
  };
  return s[code] ?? "$";
}
function percentileLabel(stat: RecapRankedStat | null): string | null {
  if (!stat || stat.rank == null || stat.total <= 0) return null;
  return `Top ${Math.max(1, Math.ceil((stat.rank / stat.total) * 100))}%`;
}
function rankLabel(stat: RecapRankedStat | null): string | null {
  if (!stat || stat.rank == null || stat.total <= 0) return null;
  return `No. ${fmt(stat.rank)} of ${fmt(stat.total)}`;
}
/** 0..1 fill for the pill bar — closer to No.1 = fuller. */
function rankFill(stat: RecapRankedStat | null): number | null {
  if (!stat || stat.rank == null || stat.total <= 1) return null;
  return Math.max(0.04, 1 - (stat.rank - 1) / stat.total);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Deterministic helpers so the falling-emoji field is stable per slide without
 *  `Math.random` in render (which react-hooks/purity forbids). */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
function seeded(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return (x >>> 0) / 4294967296;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Count from 0 → target whenever `resetKey` changes; instant when disabled. */
function useCountUp(target: number, resetKey: number, enabled: boolean): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let startTs = 0;
    const dur = 950;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / dur);
      setVal(target * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, resetKey, enabled]);
  return enabled ? val : target;
}

interface Slide {
  key: string;
  ghost: string;
  eyebrow: string;
  value: number | null;
  format?: (n: number) => string;
  headline?: string;
  sub?: string | null;
  pillLabel?: string | null;
  pillFill?: number | null;
}

function buildSlides(recap: CharacterRecap): Slide[] {
  const s: Slide[] = [];
  const season = recap.iteration
    ? iterationLabel(recap.iteration)
    : "this season";

  s.push({
    key: "intro",
    ghost: "SEASON",
    eyebrow: `${season} · in review`,
    value: null,
    headline: recap.name,
    sub: [recap.party, recap.highestOffice].filter(Boolean).join("  ·  ") || recap.party,
  });

  if (recap.actions.total > 0) {
    const top = recap.actions.topType;
    s.push({
      key: "actions",
      ghost: "EFFORT",
      eyebrow: "You showed up",
      value: recap.actions.total,
      format: fmt,
      headline: "actions taken",
      sub: top
        ? `Your signature move — ${ACTION_LABELS[top] ?? top}, ${fmt(recap.actions.byType[top] ?? 0)} times`
        : null,
      pillLabel: percentileLabel(recap.actions.rank)
        ? `${percentileLabel(recap.actions.rank)} most active`
        : null,
      pillFill: rankFill(recap.actions.rank),
    });
  }

  if (recap.highestOffice) {
    s.push({
      key: "office",
      ghost: "OFFICE",
      eyebrow: "You rose to",
      value: null,
      headline: recap.highestOffice,
      sub: "The highest office you held this season.",
    });
  }

  if (recap.elections.entered > 0) {
    s.push({
      key: "ballot",
      ghost: "BALLOT",
      eyebrow: "On the ballot",
      value: recap.elections.won,
      format: fmt,
      headline: recap.elections.won === 1 ? "race won" : "races won",
      sub: `You stood in ${fmt(recap.elections.entered)} ${
        recap.elections.entered === 1 ? "race" : "races"
      } and conceded ${fmt(recap.elections.lost)}.`,
    });
  }

  if (recap.influence.nationalInfluence > 0 || recap.influence.politicalInfluence > 0) {
    s.push({
      key: "clout",
      ghost: "CLOUT",
      eyebrow: "Your standing",
      value: recap.influence.nationalInfluence,
      format: (n) => n.toFixed(1),
      headline: "national influence",
      sub: `${recap.influence.politicalInfluence.toFixed(1)} political influence`,
      pillLabel: percentileLabel(recap.influence.npi)
        ? `${percentileLabel(recap.influence.npi)} nationwide · ${rankLabel(recap.influence.npi)}`
        : null,
      pillFill: rankFill(recap.influence.npi),
    });
  }

  if (recap.favorability) {
    s.push({
      key: "favor",
      ghost: "FAVOR",
      eyebrow: "How they saw you",
      value: recap.favorability.value,
      format: (n) => `${n.toFixed(0)}%`,
      headline: "favorability",
      sub: recap.infamy > 0 ? `…and ${recap.infamy.toFixed(0)} infamy. You made noise.` : null,
      pillLabel: percentileLabel(recap.favorability)
        ? `${percentileLabel(recap.favorability)} most liked`
        : null,
      pillFill: rankFill(recap.favorability),
    });
  }

  const money = recap.netWorth ?? recap.campaignFunds;
  if (money) {
    const sym = currencySymbolFor(recap.countryId);
    s.push({
      key: "wealth",
      ghost: "WEALTH",
      eyebrow: recap.netWorth ? "Your empire" : "Your war chest",
      value: money.value,
      format: (n) => `${sym}${compact(n)}`,
      headline: recap.netWorth ? "net worth" : "campaign funds",
      sub: rankLabel(money) ? `${rankLabel(money)} richest` : null,
      pillLabel: percentileLabel(money) ? `${percentileLabel(money)} wealthiest` : null,
      pillFill: rankFill(money),
    });
  }

  if (recap.bills.sponsored > 0) {
    s.push({
      key: "law",
      ghost: "LAW",
      eyebrow: "The lawmaker",
      value: recap.bills.sponsored,
      format: fmt,
      headline: recap.bills.sponsored === 1 ? "bill sponsored" : "bills sponsored",
      sub: `${fmt(recap.bills.passed)} of them became law.`,
    });
  }

  if (recap.social) {
    const so = recap.social;
    s.push({
      key: "wire",
      ghost: "THE WIRE",
      eyebrow: "On the news wire",
      value: so.posts,
      format: fmt,
      headline: so.posts === 1 ? "post published" : "posts published",
      sub:
        [
          so.subscribers > 0 ? `${fmt(so.subscribers)} subscribers` : null,
          so.likes > 0 ? `${fmt(so.likes)} likes` : null,
        ]
          .filter(Boolean)
          .join("  ·  ") || null,
    });
  }

  if (recap.achievements.count > 0) {
    const names = recap.achievements.highlights.map((h) => h.name).slice(0, 3);
    s.push({
      key: "honors",
      ghost: "HONORS",
      eyebrow: "For the record",
      value: recap.achievements.count,
      format: fmt,
      headline: recap.achievements.count === 1 ? "achievement earned" : "achievements earned",
      sub: names.length ? names.join("  ·  ") : "Unlocked this season.",
    });
  }

  return s;
}

interface FinaleTile {
  label: string;
  value: string;
}
function buildFinaleTiles(recap: CharacterRecap): FinaleTile[] {
  const tiles: FinaleTile[] = [];
  if (recap.actions.total > 0) tiles.push({ label: "Actions", value: fmt(recap.actions.total) });
  if (recap.highestOffice) tiles.push({ label: "Highest office", value: recap.highestOffice });
  if (recap.elections.entered > 0)
    tiles.push({
      label: "Elections won",
      value: `${fmt(recap.elections.won)}/${fmt(recap.elections.entered)}`,
    });
  const money = recap.netWorth ?? recap.campaignFunds;
  if (money)
    tiles.push({
      label: "Net worth",
      value: `${currencySymbolFor(recap.countryId)}${compact(money.value)}`,
    });
  const npct = percentileLabel(recap.influence.npi);
  if (npct) tiles.push({ label: "Influence", value: npct });
  if (recap.bills.sponsored > 0)
    tiles.push({
      label: "Bills passed",
      value: `${fmt(recap.bills.passed)}/${fmt(recap.bills.sponsored)}`,
    });
  if (recap.achievements.count > 0)
    tiles.push({ label: "Achievements", value: fmt(recap.achievements.count) });
  if (recap.tenureTurns > 0) tiles.push({ label: "Turns served", value: fmt(recap.tenureTurns) });
  return tiles.slice(0, 6);
}

export interface SeasonRecapStoryProps {
  recap: CharacterRecap;
  onClose: () => void;
}

/** Gold L-shaped ticks at each corner — a certificate/ballot frame. */
function CornerTicks() {
  const base = "pointer-events-none absolute h-5 w-5 border-[color:var(--gold)]";
  return (
    <>
      <span className={`${base} left-3 top-3 border-l-2 border-t-2`} />
      <span className={`${base} right-3 top-3 border-r-2 border-t-2`} />
      <span className={`${base} bottom-3 left-3 border-b-2 border-l-2`} />
      <span className={`${base} bottom-3 right-3 border-b-2 border-r-2`} />
    </>
  );
}

export function SeasonRecapStory({ recap, onClose }: SeasonRecapStoryProps) {
  const slides = useMemo(() => buildSlides(recap), [recap]);
  const finaleTiles = useMemo(() => buildFinaleTiles(recap), [recap]);
  const total = slides.length + 1; // + finale
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const finaleRef = useRef<HTMLDivElement>(null);
  const motion = !usePrefersReducedMotion();

  const isFinale = index >= slides.length;
  const slide = isFinale ? null : slides[index];
  const season = recap.iteration
    ? iterationLabel(recap.iteration)
    : "this season";

  const countTarget = slide?.value ?? 0;
  const counted = useCountUp(countTarget, index, motion && slide?.value != null);

  // A fresh field of themed falling emoji per slide (decorative, behind a scrim).
  const emojiField = useMemo(() => {
    const set = isFinale ? FINALE_EMOJI : (SLIDE_EMOJI[slide?.key ?? "intro"] ?? DEFAULT_EMOJI);
    const seed = isFinale ? 7919 : strHash(slide?.key ?? "intro");
    return Array.from({ length: 18 }, (_, i) => {
      const r = (k: number) => seeded(seed + i * 2654435761 + k * 40503);
      return {
        ch: set[i % set.length],
        left: r(1) * 100,
        size: 15 + r(2) * 26,
        dur: 6 + r(3) * 7,
        delay: -r(4) * 13,
        drift: (r(5) * 2 - 1) * 34,
        spin: (r(6) * 2 - 1) * 280,
        opacity: 0.2 + r(7) * 0.24,
      };
    });
  }, [isFinale, slide?.key]);

  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (paused || isFinale) return;
    const t = window.setTimeout(goNext, SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [index, paused, isFinale, goNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, onClose]);

  const touchX = useRef<number | null>(null);

  const share = useCallback(async () => {
    // Share a link to the public recap page — it unfurls with an OG image on
    // Discord/social. Fall back to copying the URL to the clipboard.
    const url = `${window.location.origin}/wrapped/${recap.characterId}`;
    const seasonName = recap.iteration
      ? iterationLabel(recap.iteration)
      : "season";
    const data: ShareData = {
      title: `${recap.name}'s ${seasonName} Wrapped`,
      text: "My A House Divided season, wrapped.",
      url,
    };
    const nav = navigator as Navigator & {
      share?: (d: ShareData) => Promise<void>;
      canShare?: (d: ShareData) => boolean;
    };
    try {
      if (nav.share && (!nav.canShare || nav.canShare(data))) {
        await nav.share(data);
        return;
      }
    } catch {
      // share sheet dismissed or failed — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* best-effort */
    }
  }, [recap.characterId, recap.name, recap.iteration]);

  // The overlay is `position: fixed`, which is only viewport-relative while no
  // ancestor creates a containing block. Mounted inline it inherits one from
  // any ancestor with transform/filter/backdrop-filter (e.g. the Settings
  // panel's `backdrop-blur-sm`, which also `overflow-hidden`-clips it), so the
  // story renders scrunched inside that box instead of full-screen. Portalling
  // to document.body makes the story independent of where it is mounted.
  const [portalTarget] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  const ground = isFinale ? FINALE_GROUND : GROUNDS[index % GROUNDS.length];
  const enter = (delay: number) =>
    motion
      ? {
          animation: `ahd-recap-in 560ms cubic-bezier(.16,1,.3,1) both`,
          animationDelay: `${delay}ms`,
        }
      : undefined;

  // Null on the very first render (before the mount effect resolves the portal
  // target) — every hook above has already run, so this is a safe early return.
  if (!portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center"
      style={{ ["--gold" as string]: GOLD }}
      role="dialog"
      aria-modal
      aria-label="Season recap"
    >
      <style>{`
        @keyframes ahd-recap-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        @keyframes ahd-recap-fill{from{width:0%}to{width:100%}}
        @keyframes ahd-recap-fall{from{transform:translate3d(0,-16vh,0) rotate(0deg)}to{transform:translate3d(var(--drift,0),116vh,0) rotate(var(--spin,180deg))}}
        @keyframes ahd-recap-shine{0%{transform:translateX(-120%)}60%,100%{transform:translateX(220%)}}
        @keyframes ahd-recap-bar{from{transform:scaleX(0)}to{transform:scaleX(var(--fill,0))}}
      `}</style>

      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

      <div
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden shadow-2xl sm:my-4 sm:rounded-[28px]"
        style={{ background: ground, color: CREAM }}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
          if (dx < -50) goNext();
          else if (dx > 50) goPrev();
          touchX.current = null;
        }}
      >
        {/* Falling themed emoji + readability scrim */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {motion &&
            emojiField.map((e, i) => (
              <span
                key={`${index}-${i}`}
                aria-hidden
                className="absolute top-0 will-change-transform"
                style={{
                  left: `${e.left}%`,
                  fontSize: `${e.size}px`,
                  opacity: e.opacity,
                  ["--drift" as string]: `${e.drift}px`,
                  ["--spin" as string]: `${e.spin}deg`,
                  animation: `ahd-recap-fall ${e.dur}s linear ${e.delay}s infinite`,
                  animationPlayState: paused ? "paused" : "running",
                  filter: "drop-shadow(0 2px 3px rgba(0,0,0,.28))",
                }}
              >
                {e.ch}
              </span>
            ))}
          {/* Center vignette keeps the headline legible over any ground + emoji. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(125% 85% at 50% 46%, rgba(0,0,0,.46) 0%, rgba(0,0,0,.22) 46%, rgba(0,0,0,0) 74%)",
            }}
          />
          {/* Top scrim so the header row always reads on lighter grounds. */}
          <div
            className="absolute inset-x-0 top-0 h-28"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,.55), transparent)" }}
          />
        </div>

        <CornerTicks />

        {/* Progress segments */}
        <div className="relative z-30 flex gap-1.5 px-5 pt-5">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full"
                style={{
                  background: CREAM,
                  ...(i < index
                    ? { width: "100%" }
                    : i === index && !isFinale
                      ? {
                          width: "0%",
                          animation: motion
                            ? `ahd-recap-fill ${SLIDE_MS}ms linear forwards`
                            : undefined,
                          animationPlayState: paused ? "paused" : "running",
                          ...(motion ? {} : { width: "100%" }),
                        }
                      : i === index && isFinale
                        ? { width: "100%" }
                        : { width: "0%" }),
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div
          className="relative z-30 flex items-center justify-between px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/90"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,.6)" }}
        >
          <span>A House Divided</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play" : "Pause"}
              className="transition-opacity hover:opacity-60"
            >
              {paused ? "▶" : "❚❚"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-base leading-none transition-opacity hover:opacity-60"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        {!isFinale && slide && (
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 py-14 text-center">
            <div className="relative">
              <p
                style={enter(40)}
                className="mb-6 flex items-center justify-center gap-3 text-xs font-bold uppercase tracking-[0.28em]"
              >
                <span className="h-px w-6" style={{ background: GOLD }} />
                <span style={{ color: GOLD }}>{slide.eyebrow}</span>
                <span className="h-px w-6" style={{ background: GOLD }} />
              </p>

              {slide.value != null ? (
                <div style={enter(120)}>
                  <div
                    className="font-black leading-[0.9] tabular-nums"
                    style={{
                      fontSize: "clamp(3.75rem,17vw,6.5rem)",
                      letterSpacing: "-0.03em",
                      textShadow: "0 2px 24px rgba(0,0,0,.25)",
                    }}
                  >
                    {(slide.format ?? fmt)(counted)}
                  </div>
                  <p className="mt-3 text-xl font-semibold tracking-tight text-white/85">
                    {slide.headline}
                  </p>
                </div>
              ) : (
                <h2
                  style={{
                    ...enter(120),
                    fontSize: "clamp(2.25rem,9vw,3.75rem)",
                    letterSpacing: "-0.02em",
                    textShadow: "0 2px 24px rgba(0,0,0,.25)",
                  }}
                  className="text-balance font-black leading-[0.98]"
                >
                  {slide.headline}
                </h2>
              )}

              {slide.sub && (
                <p
                  style={enter(240)}
                  className="mx-auto mt-6 max-w-xs text-[15px] font-medium leading-relaxed text-white/80"
                >
                  {slide.sub}
                </p>
              )}

              {slide.pillLabel && (
                <div style={enter(340)} className="mx-auto mt-6 w-fit max-w-full">
                  <div className="flex items-center gap-2.5 rounded-full border border-white/20 bg-black/20 px-4 py-2 backdrop-blur-sm">
                    <span className="text-sm font-bold tracking-tight" style={{ color: GOLD }}>
                      {slide.pillLabel}
                    </span>
                  </div>
                  {slide.pillFill != null && (
                    <div className="mx-auto mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/20">
                      <div
                        className="h-full origin-left rounded-full"
                        style={{
                          background: GOLD,
                          ["--fill" as string]: slide.pillFill,
                          transform: motion ? undefined : `scaleX(${slide.pillFill})`,
                          animation: motion
                            ? "ahd-recap-bar 900ms 400ms cubic-bezier(.16,1,.3,1) both"
                            : undefined,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Finale — official record card (screenshot target) */}
        {isFinale && (
          <div className="relative z-10 flex flex-1 flex-col px-5 pb-6 pt-3">
            <div
              ref={finaleRef}
              className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border p-6"
              style={{ background: FINALE_GROUND, borderColor: `${GOLD}66` }}
            >
              {/* shimmer sweep */}
              {motion && (
                <div
                  className="pointer-events-none absolute inset-0 -skew-x-12"
                  style={{
                    background:
                      "linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)",
                    animation: "ahd-recap-shine 2.6s ease-in-out 0.4s infinite",
                  }}
                />
              )}
              <div
                className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.08]"
                style={{ backgroundImage: GRAIN }}
              />

              <p
                className="text-center text-[11px] font-bold uppercase tracking-[0.32em]"
                style={{ color: GOLD }}
              >
                Official record · {season}
              </p>
              <div className="mx-auto mt-3 mb-1 h-px w-16" style={{ background: `${GOLD}88` }} />

              <h2
                className="mt-2 text-center font-black uppercase leading-[0.95]"
                style={{ fontSize: "clamp(2rem,8vw,2.9rem)", letterSpacing: "-0.02em" }}
              >
                {recap.name}
              </h2>
              <p className="mt-1 text-center text-sm font-medium text-white/75">
                {[recap.party, recap.highestOffice].filter(Boolean).join("  ·  ") || recap.party}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4">
                {finaleTiles.map((t) => (
                  <div
                    key={t.label}
                    className="border-t pt-2"
                    style={{ borderColor: "rgba(255,255,255,.14)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                      {t.label}
                    </p>
                    <p
                      className="mt-0.5 truncate text-lg font-black tabular-nums tracking-tight"
                      style={{ color: CREAM }}
                    >
                      {t.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-6 text-center">
                <p className="text-sm font-semibold text-white/90">That was your season.</p>
                <p className="mt-0.5 text-xs uppercase tracking-[0.28em]" style={{ color: GOLD }}>
                  A House Divided · Wrapped
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={share}
                className="rounded-full px-6 py-2.5 text-sm font-bold text-zinc-950 shadow-lg transition-transform hover:scale-[1.04]"
                style={{ background: GOLD }}
              >
                {copied ? "Link copied ✓" : "Share your Wrapped"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/35 px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Tap zones (below header, above ambient; hidden on finale) */}
        {!isFinale && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={goPrev}
              className="absolute bottom-0 left-0 top-20 z-20 w-1/3 cursor-default focus:outline-none"
            />
            <button
              type="button"
              aria-label="Next"
              onClick={goNext}
              className="absolute bottom-0 right-0 top-20 z-20 w-2/3 cursor-default focus:outline-none"
            />
          </>
        )}
      </div>
    </div>,
    portalTarget
  );
}
