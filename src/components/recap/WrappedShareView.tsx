"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CharacterRecap } from "@/lib/recap/types";
import { recapAccent } from "@/lib/recap/accent";
import { SeasonRecapStory } from "./SeasonRecapStory";
import { WRAPPED_KEYFRAMES } from "./wrapped/charts";
import { WrappedPoster } from "./wrapped/WrappedPoster";
import { usePrefersReducedMotion } from "./wrapped/useStoryPlayer";

/**
 * Public landing for a shared recap link (`/wrapped/[characterId]`): the
 * poster, a button to play the full story, and a way into the game. No auth.
 */
export function WrappedShareView({ recap }: { recap: CharacterRecap }) {
  const [playing, setPlaying] = useState(false);
  const accent = useMemo(() => recapAccent(recap.partyColor), [recap.partyColor]);
  const motion = !usePrefersReducedMotion();

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-10 text-white">
      <style>{WRAPPED_KEYFRAMES}</style>
      <div className="w-full max-w-[440px]">
        <div className="min-h-[640px] rounded-[22px] border border-white/10 px-7 py-8">
          <WrappedPoster recap={recap} accent={accent} motion={motion} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="flex-1 rounded-full bg-white px-5 py-3 text-[15px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Play the story
          </button>
          <Link
            href="/"
            className="flex-1 rounded-full border border-white/25 px-5 py-3 text-center text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            Play A House Divided
          </Link>
        </div>
      </div>

      {playing && <SeasonRecapStory recap={recap} onClose={() => setPlaying(false)} />}
    </div>
  );
}
