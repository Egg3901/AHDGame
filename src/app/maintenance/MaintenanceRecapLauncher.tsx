"use client";

import { useState } from "react";
import type { CharacterRecap } from "@/lib/recap/types";
import { SeasonRecapStory } from "@/components/recap/SeasonRecapStory";

/**
 * Re-watch entry for a player's Season Recap while the game is between
 * iterations (maintenance). The global SeasonRecapGate still auto-opens it once
 * on the first login after the reset; this button lets them replay it any time
 * during the down-window. Purely opens the story — does not re-mark it seen.
 */
export function MaintenanceRecapLauncher({ recap }: { recap: CharacterRecap }) {
  const [open, setOpen] = useState(false);
  const season = recap.iteration
    ? `${recap.iteration.type} ${recap.iteration.number}`
    : "last season";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-white shadow-lg transition-transform hover:scale-[1.03]"
      >
        ✨ Watch your {season} Wrapped
      </button>
      {open && <SeasonRecapStory recap={recap} onClose={() => setOpen(false)} />}
    </>
  );
}
