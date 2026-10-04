"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "lucide-react";
import type { CharacterRecap } from "@/lib/recap/types";
import { recapAccent } from "@/lib/recap/accent";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { buildStory } from "./wrapped/story";
import { SLIDES } from "./wrapped/slides";
import { WRAPPED_KEYFRAMES } from "./wrapped/charts";
import { WrappedPoster } from "./wrapped/WrappedPoster";
import { usePrefersReducedMotion, useStoryPlayer } from "./wrapped/useStoryPlayer";

/**
 * Season Recap ("Wrapped"): a full-screen, tap-through story of a character's
 * just-ended political life. Black ground, white type, and one data color: the
 * player's party color marks "you" in every chart. Each slide is its own
 * composition (season strip, a guess, the career ladder, election night, the
 * rival scoreboard, a roll call, standings, awards) and only appears when the
 * recap has data for it, so v1 recaps play a shorter story. Reused by the
 * post-reset gate, the maintenance page, character history and the public
 * share page. Respects prefers-reduced-motion.
 */

export interface SeasonRecapStoryProps {
  recap: CharacterRecap;
  onClose: () => void;
}

export function SeasonRecapStory({ recap, onClose }: SeasonRecapStoryProps) {
  const story = useMemo(() => buildStory(recap), [recap]);
  const accent = useMemo(() => recapAccent(recap.partyColor), [recap.partyColor]);
  const motion = !usePrefersReducedMotion();
  const player = useStoryPlayer(
    story.map((s) => s.ms),
    true
  );
  const { index, next, prev, togglePause, paused } = player;
  const slide = story[index];
  const isFinale = slide?.kind === "finale";
  const season = recap.iteration ? iterationLabel(recap.iteration) : "Season";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  const touchX = useRef<number | null>(null);

  const share = useCallback(async () => {
    const url = `${window.location.origin}/wrapped/${recap.characterId}`;
    const data: ShareData = {
      title: `${recap.name}'s ${season} Wrapped`,
      text: "My season in A House Divided.",
      url,
    };
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.share && (!nav.canShare || nav.canShare(data))) {
        await nav.share(data);
        return;
      }
    } catch {
      // share sheet dismissed; fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* best-effort */
    }
  }, [recap.characterId, recap.name, season]);

  // Portal to <body>: an ancestor with transform/filter/backdrop-filter (the
  // Settings panel's backdrop-blur) would otherwise become the containing
  // block for `position: fixed` and clip the story inside that box.
  const [portalTarget] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );
  if (!portalTarget || !slide) return null;

  const Body = SLIDES[slide.kind];

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center bg-black/90 sm:items-center"
      role="dialog"
      aria-modal
      aria-label={`${season} Wrapped`}
    >
      <style>{WRAPPED_KEYFRAMES}</style>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div
        className="relative flex h-full w-full max-w-[440px] flex-col overflow-hidden bg-black text-white sm:h-[min(880px,calc(100dvh-32px))] sm:rounded-[22px] sm:border sm:border-white/10"
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
          if (dx < -50) next();
          else if (dx > 50) prev();
          touchX.current = null;
        }}
      >
        {/* Progress */}
        <div className="absolute inset-x-0 top-0 z-30 flex gap-1 px-4 pt-3">
          {story.map((s, i) => (
            <div
              key={`${s.kind}-${i}`}
              className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full bg-white"
                style={{ width: `${i < index ? 100 : i === index ? player.progress * 100 : 0}%` }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-7">
          <span className="text-[13px] font-semibold tracking-tight text-white/80">
            A House Divided
          </span>
          <div className="flex items-center gap-1">
            {!isFinale && (
              <button
                type="button"
                onClick={togglePause}
                aria-label={paused ? "Play" : "Pause"}
                className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/10"
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tap zones sit under the slide; only interactive slide controls take pointer events. */}
        {!isFinale && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={prev}
              className="absolute bottom-0 left-0 top-16 z-10 w-1/3 cursor-default focus:outline-none"
            />
            <button
              type="button"
              aria-label="Next"
              onClick={next}
              className="absolute bottom-0 right-0 top-16 z-10 w-2/3 cursor-default focus:outline-none"
            />
          </>
        )}

        <div
          key={index}
          className={`relative z-20 flex-1 ${isFinale ? "" : "pointer-events-none"}`}
        >
          {isFinale ? (
            <div className="flex h-full flex-col px-7 pb-6 pt-20">
              <div className="min-h-0 flex-1">
                <WrappedPoster recap={recap} accent={accent} motion={motion} />
              </div>
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={share}
                  className="flex-1 rounded-full bg-white px-5 py-3 text-[15px] font-semibold text-black transition-opacity hover:opacity-90"
                >
                  {copied ? "Link copied" : "Share"}
                </button>
                <a
                  href={`/wrapped/${recap.characterId}/story-image`}
                  download={`${recap.name} ${season} Wrapped.png`}
                  className="flex-1 rounded-full border border-white/25 px-5 py-3 text-center text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Save image
                </a>
              </div>
              <div className="mt-3 flex justify-between text-[13px] text-white/55">
                <button
                  type="button"
                  onClick={() => player.goTo(0)}
                  className="py-1 hover:text-white"
                >
                  Watch again
                </button>
                <button type="button" onClick={onClose} className="py-1 hover:text-white">
                  Done
                </button>
              </div>
            </div>
          ) : (
            Body && <Body recap={recap} accent={accent} motion={motion} player={player} />
          )}
        </div>
      </div>
    </div>,
    portalTarget
  );
}
