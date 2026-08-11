"use client";

import { useState } from "react";
import { easeInOutCubic } from "../worldConstants";

interface MapControlsProps {
  viewMode: "map" | "globe";
  isAnimating: boolean;
  isFullscreen: boolean;
  onViewChange: (target: "map" | "globe") => void;
  onFullscreenToggle: () => void;
  zoomRef: React.MutableRefObject<number>;
  imperativeUpdate: () => void;
  syncPathsState: () => void;
}

export default function MapControls({
  viewMode,
  isAnimating,
  isFullscreen,
  onViewChange,
  onFullscreenToggle,
  zoomRef,
  imperativeUpdate,
  syncPathsState,
}: MapControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const zoomIn = () => {
    const nextZoom = Math.min(zoomRef.current * 1.5, 8);
    const startZoom = zoomRef.current;
    const startTime = performance.now();
    const duration = 300;

    const animateZoom = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);

      zoomRef.current = startZoom + (nextZoom - startZoom) * ease;
      imperativeUpdate();

      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      } else {
        syncPathsState();
      }
    };
    requestAnimationFrame(animateZoom);
  };

  const zoomOut = () => {
    const nextZoom = Math.max(zoomRef.current / 1.5, 1);
    const startZoom = zoomRef.current;
    const startTime = performance.now();
    const duration = 300;

    const animateZoom = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);

      zoomRef.current = startZoom + (nextZoom - startZoom) * ease;
      imperativeUpdate();

      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      } else {
        syncPathsState();
      }
    };
    requestAnimationFrame(animateZoom);
  };

  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2 pointer-events-none">
      {/* Icon buttons row: fullscreen + gear */}
      <div className="flex items-center gap-1 pointer-events-auto">
        <button
          onClick={onFullscreenToggle}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-card/90 backdrop-blur-md border border-card-border shadow-sm text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg bg-card/90 backdrop-blur-md border border-card-border shadow-sm transition-colors ${
            menuOpen
              ? "text-primary bg-card-elevated"
              : "text-muted hover:text-foreground hover:bg-card-elevated"
          }`}
          title="Settings"
          aria-label="Map settings"
          aria-expanded={menuOpen}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Collapsible settings: map/globe toggle only */}
      {menuOpen && (
        <div className="pointer-events-auto animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-card-border shadow-sm">
            <button
              onClick={() => onViewChange("map")}
              disabled={isAnimating}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                viewMode === "map"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-card-elevated"
              }`}
            >
              Map
            </button>
            <button
              onClick={() => onViewChange("globe")}
              disabled={isAnimating}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                viewMode === "globe"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-card-elevated"
              }`}
            >
              Globe
            </button>
          </div>
        </div>
      )}

      {/* Zoom Controls — always visible */}
      <div className="flex flex-col gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-card-border shadow-sm pointer-events-auto">
        <button
          onClick={zoomIn}
          className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
          title="Zoom In"
          aria-label="Zoom in"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <div className="h-px w-full bg-card-border" />
        <button
          onClick={zoomOut}
          className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
          title="Zoom Out"
          aria-label="Zoom out"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
    </div>
  );
}
