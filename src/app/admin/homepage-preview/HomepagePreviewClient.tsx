"use client";

/**
 * Admin-only preview of the redesigned public home page.
 *
 * The design itself lives in `SandboxHome` (also the real sandbox `/` landing);
 * this page wraps it in admin chrome — a theme picker so all 11 themes can be
 * reviewed, an era picker so a seed's landing (the 1991 broadcast hero, say)
 * can be checked before a reset puts it live, and a signed-out / signed-in
 * toggle to check both CTA states. The preview renders the design full-bleed
 * (no bordered frame) so it matches what sandbox visitors actually see. Not
 * visible to players.
 */
import { useMemo, useState } from "react";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { SandboxHome } from "@/app/_landing-v2/SandboxHome";
import { ERA_CONFIGS, type EraId } from "@/components/landing/eraThemes";
import type { GovernmentType } from "@/lib/constants/countries";
import { fallbackMarketedWorld, toEraId, type MarketedWorld } from "@/lib/marketing/marketedWorld";

const ERA_PICKER = Object.values(ERA_CONFIGS).map((config) => ({
  value: config.id,
  label: config.label,
}));

const THEME_PICKER: { value: Theme; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "light", label: "Light" },
  { value: "oled", label: "OLED" },
  { value: "usa", label: "USA" },
  { value: "pastel", label: "Pastel" },
  { value: "dark-pastel", label: "Dark pastel" },
  { value: "retro", label: "Retro" },
  { value: "solarized", label: "Solarized" },
  { value: "cloakroom", label: "Cloakroom" },
  { value: "broadsheet", label: "Broadsheet" },
  { value: "coldwar", label: "Cold War" },
  { value: "command-1953", label: "1953 Command" },
];

export function HomepagePreviewClient({
  governmentTypes = {},
  world,
  backgroundMacroByEra = {},
}: {
  governmentTypes?: Record<string, GovernmentType>;
  world: MarketedWorld;
  /** Macro-simulated Background Nations per era id, read on the server. */
  backgroundMacroByEra?: Partial<Record<string, readonly string[]>>;
}) {
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<"signed-out" | "signed-in">("signed-out");
  // Opens on the live world's era, so the default is what players see.
  const liveEra = toEraId(world.seedYear);
  const [era, setEra] = useState<EraId>(liveEra);
  // Another era gets its own roster and year rather than the live world's,
  // and every player nation reads "0 playing", as on the day after a reset.
  const previewWorld = useMemo(
    () =>
      era === liveEra ? world : { ...fallbackMarketedWorld(Number(era)), version: world.version },
    [era, liveEra, world]
  );
  const previewCounts = useMemo(
    () =>
      era === liveEra
        ? undefined
        : Object.fromEntries(
            ERA_CONFIGS[era].nations
              .filter((nation) => nation.tier === "player")
              .map((nation) => [nation.id, 0])
          ),
    [era, liveEra]
  );

  return (
    <div className="bg-background text-foreground">
      {/* Admin preview chrome (not part of the landing design itself). Sticky so
          it stays reachable while the full-bleed design scrolls underneath. */}
      <div className="sticky top-0 z-50 border-b border-card-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-body-sm text-muted">
            <span className="rounded-md bg-warning/10 px-2 py-0.5 text-body-xs font-semibold uppercase tracking-wider text-warning">
              Admin preview
            </span>
            <span>
              Home page · {ERA_CONFIGS[era].label}
              {era === liveEra ? " · live world" : " · preview"} · not visible to players
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm text-muted">
              <span className="text-body-xs uppercase tracking-widest">Era</span>
              <select
                value={era}
                onChange={(e) => setEra(e.target.value as EraId)}
                className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Preview era"
              >
                {ERA_PICKER.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-body-sm text-muted">
              <span className="text-body-xs uppercase tracking-widest">Theme</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
                className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Preview theme"
              >
                {THEME_PICKER.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {/* Signed-out / signed-in view toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-card-border bg-background p-0.5">
              {(["signed-out", "signed-in"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 text-body-xs font-semibold uppercase tracking-wider transition-colors ${
                    view === v ? "bg-primary text-white" : "text-muted hover:text-foreground"
                  }`}
                  aria-pressed={view === v}
                >
                  {v === "signed-out" ? "Signed out" : "Signed in"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Keyed on era: the globe loads its roster and art once per mount. */}
      <SandboxHome
        key={era}
        isSignedIn={view === "signed-in"}
        era={era}
        playerCounts={previewCounts}
        governmentTypes={governmentTypes}
        world={previewWorld}
        backgroundMacroFeatureIds={backgroundMacroByEra[era]}
      />
    </div>
  );
}
