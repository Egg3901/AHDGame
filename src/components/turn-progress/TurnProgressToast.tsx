"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { describeTurnPhase } from "./turnProgressPresentation";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";

const EXCLUDED_PATHS = ["/", "/login", "/register", "/banned"];

export function TurnProgressToast() {
  const pathname = usePathname();
  const enabled = !EXCLUDED_PATHS.includes(pathname) && !isLightweightLayoutPath(pathname);
  const status = useGameTurnStatus(enabled);
  const [dismissedTurn, setDismissedTurn] = useState<number | null>(null);

  if (!status?.isProcessing || dismissedTurn === status.processingTargetTurn) return null;
  const progress = Math.max(2, Math.min(98, status.processingProgress ?? 2));
  return (
    <aside
      className="fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom))] right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-card-border/80 bg-card/95 shadow-2xl backdrop-blur-xl sm:right-5"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 p-3.5">
        <div className="relative h-10 w-10 shrink-0">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <span className="absolute inset-1 animate-pulse rounded-full bg-primary/10" />
          <Image
            src="/icon.png"
            alt=""
            width={32}
            height={32}
            className="absolute inset-1 rounded-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            Processing turn {status.processingTargetTurn ?? ""}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {describeTurnPhase(status.processingPhase ?? null, status.processingPhaseLabel ?? null)}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-lg leading-none text-muted transition hover:bg-foreground/5 hover:text-foreground"
          aria-label="Dismiss turn progress"
          onClick={() => setDismissedTurn(status.processingTargetTurn ?? null)}
        >
          ×
        </button>
      </div>
      <div className="h-1.5 bg-foreground/5">
        <div
          className="h-full rounded-r-full bg-gradient-to-r from-primary via-red-400 to-primary transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </aside>
  );
}
