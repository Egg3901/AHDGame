"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { type StatusBarLayout } from "@/components/StatusBar";
import { LanguageSection } from "./LanguageSection";

interface ThemeOption {
  value: Theme;
  label: string;
  role: string;
  bg: string;
  card: string;
  border: string;
  fg: string;
  fg2: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "default",
    label: "Default",
    role: "Dark · Premium",
    bg: "#14141c",
    card: "#1d1d2a",
    border: "#2a2a3d",
    fg: "#e8e8ee",
    fg2: "#b8b8c4",
    primary: "#dc2626",
    secondary: "#1d4ed8",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
  },
  {
    value: "oled",
    label: "OLED",
    role: "Dark · True black",
    bg: "#000000",
    card: "#070710",
    border: "#242436",
    fg: "#ffffff",
    fg2: "#d4d4dc",
    primary: "#ff3b3b",
    secondary: "#4d8cff",
    success: "#2ee064",
    warning: "#ffd60a",
    error: "#ff5a5a",
  },
  {
    value: "cloakroom",
    label: "Cloakroom",
    role: "Dark · Warm",
    bg: "#12100e",
    card: "#1c1915",
    border: "#2a2620",
    fg: "#f5ecd8",
    fg2: "#c9bfa8",
    primary: "#9b2a2a",
    secondary: "#c99a3d",
    success: "#8ea65a",
    warning: "#d4a244",
    error: "#b9452e",
  },
  {
    value: "broadsheet",
    label: "Broadsheet",
    role: "Light · Editorial",
    bg: "#f3efe6",
    card: "#fbf8f0",
    border: "#d6cfbd",
    fg: "#1a1614",
    fg2: "#3d342e",
    primary: "#8c1c1c",
    secondary: "#1e3a5f",
    success: "#4a7c2f",
    warning: "#a66b16",
    error: "#a83232",
  },
  {
    value: "coldwar",
    label: "Cold War",
    role: "Dark · Terminal",
    bg: "#0a0906",
    card: "#12100a",
    border: "#2a2416",
    fg: "#f5c46a",
    fg2: "#c9a04b",
    primary: "#ff7849",
    secondary: "#6fa8dc",
    success: "#86d978",
    warning: "#ffc14d",
    error: "#ff5a3c",
  },
  {
    value: "command-1953",
    label: "1953 Command",
    role: "Dark · Phosphor CRT",
    bg: "#050805",
    card: "#091109",
    border: "#1b4a20",
    fg: "#b8ffad",
    fg2: "#76c86e",
    primary: "#39ff14",
    secondary: "#00ff41",
    success: "#67ff72",
    warning: "#d7ff45",
    error: "#ff6b4a",
  },
  {
    value: "usa",
    label: "USA",
    role: "Dark · Patriotic",
    bg: "#0f1e38",
    card: "#182a4a",
    border: "#243b60",
    fg: "#fffbeb",
    fg2: "#c8d4e8",
    primary: "#ef4444",
    secondary: "#3b82f6",
    success: "#84cc16",
    warning: "#facc15",
    error: "#f87171",
  },
  {
    value: "light",
    label: "Light",
    role: "Light · Default",
    bg: "#f8fafc",
    card: "#ffffff",
    border: "#e2e8f0",
    fg: "#0f172a",
    fg2: "#334155",
    primary: "#dc2626",
    secondary: "#2563eb",
    success: "#16a34a",
    warning: "#ca8a04",
    error: "#dc2626",
  },
  {
    value: "pastel",
    label: "Pastel",
    role: "Light · Soft",
    bg: "#fdf4ff",
    card: "#ffffff",
    border: "#e9d5ff",
    fg: "#4a044e",
    fg2: "#701a75",
    primary: "#d946ef",
    secondary: "#8b5cf6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#e11d48",
  },
  {
    value: "dark-pastel",
    label: "Dark Pastel",
    role: "Dark · Neo",
    bg: "#0e0b18",
    card: "#16112a",
    border: "#241d40",
    fg: "#ede0ff",
    fg2: "#c8b8e8",
    primary: "#c084fc",
    secondary: "#67e8f9",
    success: "#86efac",
    warning: "#fde047",
    error: "#fda4af",
  },
  {
    value: "retro",
    label: "Retro",
    role: "Dark · CRT",
    bg: "#0a0f0a",
    card: "#0e160e",
    border: "#1a2a1a",
    fg: "#b8e6b8",
    fg2: "#8ac48a",
    primary: "#4af626",
    secondary: "#26f6ce",
    success: "#4af626",
    warning: "#f6e626",
    error: "#f64a4a",
  },
  {
    value: "solarized",
    label: "Solarized",
    role: "Dark · Classic",
    bg: "#002b36",
    card: "#073642",
    border: "#0a4858",
    fg: "#eee8d5",
    fg2: "#93a1a1",
    primary: "#dc322f",
    secondary: "#268bd2",
    success: "#859900",
    warning: "#b58900",
    error: "#cb4b16",
  },
];

const VISIBLE = 4;
const PAGES = Math.ceil(THEME_OPTIONS.length / VISIBLE);

interface Props {
  disableAutoplayOnOtherProfiles: boolean;
  onAutoplayChange: (value: boolean) => void;
  enableExperimentalUI: boolean;
  onExperimentalUiChange: (value: boolean) => void;
}

export function AppearanceSection({
  disableAutoplayOnOtherProfiles,
  onAutoplayChange,
  enableExperimentalUI,
  onExperimentalUiChange,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [page, setPage] = useState(0);
  const [statusBarLayout, setStatusBarLayout] = useState<StatusBarLayout>("standard");
  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- reading localStorage */
  useEffect(() => {
    const saved = localStorage.getItem("statusBarLayout");
    if (saved === "corp" || saved === "elections" || saved === "full" || saved === "minimal")
      setStatusBarLayout(saved);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Snap the carousel to the page containing the active theme on first render
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- reading active theme from context to derive initial page index */
  useEffect(() => {
    const idx = THEME_OPTIONS.findIndex((t) => t.value === theme);
    if (idx >= 0) setPage(Math.floor(idx / VISIBLE));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const updateTrack = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const gap = 10;
    const slideW = (viewport.clientWidth - gap * (VISIBLE - 1)) / VISIBLE;
    const offset = page * VISIBLE * (slideW + gap);
    track.style.transform = `translateX(-${offset}px)`;
  }, [page]);

  useEffect(() => {
    updateTrack();
    window.addEventListener("resize", updateTrack);
    return () => window.removeEventListener("resize", updateTrack);
  }, [updateTrack]);

  const handleLayoutChange = (layout: StatusBarLayout) => {
    setStatusBarLayout(layout);
    localStorage.setItem("statusBarLayout", layout);
    window.dispatchEvent(new StorageEvent("storage", { key: "statusBarLayout", newValue: layout }));
    fetchJson("/api/settings/status-bar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
      feature: "settings-status-bar-layout",
    }).catch(() => {});
  };

  const selectedTheme = THEME_OPTIONS.find((t) => t.value === theme);

  return (
    <>
      <p className="text-sm text-muted mb-5">
        Choose how the app looks. The landing page always uses the default theme.
      </p>

      {/* ── Carousel ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card-muted p-4 mb-2">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-sm font-medium text-foreground">Theme</span>
          <span className="text-xs text-muted">Applies instantly · syncs across devices</span>
        </div>

        <div className="relative">
          {/* Prev */}
          <button
            type="button"
            aria-label="Previous themes"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 h-8 w-8 rounded-full border border-card-border bg-card flex items-center justify-center text-muted hover:border-primary/50 hover:text-foreground transition-all disabled:opacity-30 disabled:pointer-events-none"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          {/* Track */}
          <div ref={viewportRef} className="overflow-hidden">
            <div
              ref={trackRef}
              className="flex gap-2.5 transition-transform duration-300 ease-[cubic-bezier(.4,0,.2,1)]"
            >
              {THEME_OPTIONS.map((opt) => {
                const isActive = theme === opt.value;
                const isLight = opt.value === "light" || opt.value === "pastel";
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setTheme(opt.value)}
                    style={{
                      flex: `0 0 calc((100% - ${(VISIBLE - 1) * 10}px) / ${VISIBLE})`,
                      background: opt.bg,
                      borderColor: isActive ? opt.primary : opt.border,
                    }}
                    className={`relative rounded-lg border p-2.5 text-left transition-all hover:-translate-y-0.5 ${
                      isActive
                        ? "shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_30%,transparent)] ring-0"
                        : "hover:border-muted/50"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="text-[11px] font-semibold leading-none tracking-tight"
                        style={{
                          fontFamily: "var(--font-serif, Georgia, serif)",
                          color: opt.fg,
                        }}
                      >
                        {opt.label}
                      </span>
                      {isActive && (
                        <span
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                          style={{ background: opt.primary }}
                        >
                          ✓
                        </span>
                      )}
                    </div>

                    {/* Mini preview card */}
                    <div
                      className="flex items-center gap-1.5 rounded px-1.5 py-1 mb-1.5 border"
                      style={{ background: opt.card, borderColor: opt.border }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: opt.primary }}
                      />
                      <span
                        className="h-0.5 flex-1 rounded-full opacity-40"
                        style={{ background: opt.fg2 }}
                      />
                      <span
                        className="text-[9px] font-bold font-mono tabular-nums"
                        style={{ color: isLight ? opt.fg : opt.fg }}
                      >
                        58%
                      </span>
                    </div>

                    {/* Swatches */}
                    <div className="flex gap-0.5">
                      {[opt.primary, opt.secondary, opt.success, opt.warning, opt.error].map(
                        (color, i) => (
                          <span
                            key={i}
                            className="flex-1 h-1 rounded-[1px]"
                            style={{ background: color }}
                          />
                        )
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next */}
          <button
            type="button"
            aria-label="Next themes"
            disabled={page === PAGES - 1}
            onClick={() => setPage((p) => Math.min(PAGES - 1, p + 1))}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 h-8 w-8 rounded-full border border-card-border bg-card flex items-center justify-center text-muted hover:border-primary/50 hover:text-foreground transition-all disabled:opacity-30 disabled:pointer-events-none"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Dots + status */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted font-mono">
            Selected: <span className="text-foreground">{selectedTheme?.label ?? "Default"}</span>
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: PAGES }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Page ${i + 1}`}
                onClick={() => setPage(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === page ? "w-4 bg-primary" : "w-1.5 bg-card-border hover:bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <LanguageSection />

      {/* ── Video prefs ─────────────────────────────────────────────────── */}
      <div className="border-t border-card-border pt-6">
        <h3 className="text-sm font-medium mb-3">Video Preferences</h3>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={disableAutoplayOnOtherProfiles}
            onChange={(e) => onAutoplayChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <span className="text-sm text-foreground group-hover:text-primary transition-colors">
              Disable autoplay on other users&apos; profiles
            </span>
            <p className="mt-0.5 text-xs text-muted">
              When enabled, campaign songs on other users&apos; profiles will not autoplay (only
              affects what you see)
            </p>
          </div>
        </label>
      </div>

      {/* ── Interface ───────────────────────────────────────────────────── */}
      <div className="border-t border-card-border pt-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium">Interface</h3>
        </div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={!enableExperimentalUI}
            onChange={(e) => onExperimentalUiChange(!e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <span className="text-sm text-foreground group-hover:text-primary transition-colors">
              Use the classic interface
            </span>
            <p className="mt-0.5 text-xs text-muted">
              The redesigned navigation bar and the CEO Command Center dashboard are now the
              default. Turn this on to switch back to the classic navigation bar and corporation
              pages.
            </p>
          </div>
        </label>
      </div>

      {/* ── Status Bar ──────────────────────────────────────────────────── */}
      <div className="border-t border-card-border pt-6">
        <h3 className="text-sm font-medium mb-1">Status Bar</h3>
        <p className="text-xs text-muted mb-4">
          Choose what&apos;s shown in the bottom status bar.
        </p>
        <div className="flex gap-3 flex-wrap">
          {(
            [
              {
                value: "standard",
                label: "Standard",
                desc: "Actions, campaign funds, personal cash, and corp treasury (when you are a CEO). Online count next to the turn timer.",
              },
              {
                value: "corp",
                label: "Corp Compact",
                desc: "Condensed online count; adds stock ticker, corp cash, and marketing strength when you run a corporation.",
              },
              {
                value: "elections",
                label: "Elections Compact",
                desc: "Political influence and favorability always shown. Adds vote share, margin, and seat projection when you're in an election.",
              },
              {
                value: "full",
                label: "Full",
                desc: "Larger bar: profile stats plus elections and corporation panels together (corp only if you are a CEO).",
              },
              {
                value: "minimal",
                label: "Minimal",
                desc: "Turn timer and in-game date only. No stat chips — clean and distraction-free.",
              },
            ] as { value: StatusBarLayout; label: string; desc: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleLayoutChange(opt.value)}
              aria-pressed={statusBarLayout === opt.value}
              className={`flex-1 min-w-[140px] rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                statusBarLayout === opt.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-card-border bg-background text-muted hover:border-card-border hover:bg-card-elevated hover:text-foreground"
              }`}
            >
              <span className="block font-medium mb-0.5">{opt.label}</span>
              <span className="block text-xs opacity-70">{opt.desc}</span>
            </button>
          ))}
        </div>
        {statusBarLayout === "corp" && (
          <p className="mt-3 text-xs text-muted">
            Corp data only appears if your character is a CEO.
          </p>
        )}
        {statusBarLayout === "elections" && (
          <p className="mt-3 text-xs text-muted">
            Vote share and seat projection only appear while you&apos;re an active candidate in an
            election.
          </p>
        )}
        {statusBarLayout === "full" && (
          <p className="mt-3 text-xs text-muted">
            Corporation stats only appear if your character is a CEO. Election vote and seat chips
            only appear while you&apos;re an active candidate.
          </p>
        )}
        {statusBarLayout === "minimal" && (
          <p className="mt-3 text-xs text-muted">
            Just the essentials — in-game date, turn timer, and online player count.
          </p>
        )}
      </div>
    </>
  );
}
