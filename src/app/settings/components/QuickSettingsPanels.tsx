"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  Clock3,
  Contrast,
  Database,
  Download,
  Gauge,
  Globe2,
  Languages,
  Music2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Slider } from "@/components/ui";
import { useBrowserPreferences } from "@/contexts/BrowserPreferencesContext";
import { useTheme } from "@/contexts/ThemeContext";
import { parseBrowserPreferences } from "@/lib/browserPreferences";
import { fetchJson } from "@/lib/observability/fetchJson";

interface CountryChoice {
  code: string;
  name: string;
}

function Surface({
  icon,
  title,
  description,
  children,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-card-border bg-background/45 p-4 md:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Thumb travel for the 48×28 track with an 18px knob and 4px end insets. */
export const SETTINGS_SWITCH_THUMB_OFF = "left-1 translate-x-0";
export const SETTINGS_SWITCH_THUMB_ON = "left-1 translate-x-[22px]";

/**
 * Settings control-panel switch. The thumb must keep an explicit `left-*`
 * anchor — translate-only absolute positioning used the static position and
 * parked the knob outside the track (ticket #998).
 */
export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`relative h-7 w-12 rounded-full border transition-colors duration-200 ease-out ${
          checked ? "border-primary bg-primary" : "border-card-border bg-card-elevated"
        }`}
      >
        <span
          data-testid="settings-switch-thumb"
          className={`pointer-events-none absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
            checked ? SETTINGS_SWITCH_THUMB_ON : SETTINGS_SWITCH_THUMB_OFF
          }`}
        />
      </span>
    </button>
  );
}

function Toggle(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return <SettingsSwitch {...props} />;
}

export function GameQuickSettings({ countries }: { countries: CountryChoice[] }) {
  const [turnMinutes, setTurnMinutes] = useState<number | null>(null);
  const [turnAlerts, setTurnAlerts] = useState<boolean | null>(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/game/config", { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((config) => {
          if (typeof config?.turnLengthMinutes === "number") {
            setTurnMinutes(config.turnLengthMinutes);
          }
        }),
      fetch("/api/notifications/preferences", { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (Array.isArray(data?.mutedTypes)) {
            setTurnAlerts(!data.mutedTypes.includes("turn_advance"));
          }
        }),
    ]).catch(() => {});
    return () => controller.abort();
  }, []);

  const updateTurnAlerts = async (enabled: boolean) => {
    const previous = turnAlerts;
    setTurnAlerts(enabled);
    setNotificationSaving(true);
    setNotificationMessage("Saving…");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: enabled ? "unmute" : "mute",
          type: "turn_advance",
        }),
      });
      if (!response.ok) throw new Error("notification preference rejected");
      setNotificationMessage("Saved");
    } catch {
      setTurnAlerts(previous);
      setNotificationMessage("Could not save");
    } finally {
      setNotificationSaving(false);
    }
  };

  const oneCountry = countries.length === 1 ? countries[0] : null;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {oneCountry ? (
        <Surface
          icon={<Globe2 className="h-4 w-4" />}
          title="Default country"
          description={`${oneCountry.name} (${oneCountry.code}) · Your only active country`}
          className="border-primary/30 bg-primary/[0.04]"
        />
      ) : (
        <Surface
          icon={<Globe2 className="h-4 w-4" />}
          title="Active country"
          description={
            countries.length > 0
              ? countries.map((country) => country.name).join(", ")
              : "Create a character to establish a country."
          }
        />
      )}
      <Surface
        icon={<Clock3 className="h-4 w-4" />}
        title="Turn speed"
        description={
          turnMinutes
            ? `World turns run every ${turnMinutes} minute${turnMinutes === 1 ? "" : "s"}.`
            : "Reading the live world cadence…"
        }
      >
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
          <Gauge className="h-3 w-3" />
          World controlled
        </span>
      </Surface>
      <Surface
        icon={<Bell className="h-4 w-4" />}
        title="Turn notifications"
        description="Alert me when a new world turn is ready."
      >
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted" aria-live="polite">
            {notificationMessage ??
              (turnAlerts === null ? "Loading preference…" : turnAlerts ? "On" : "Muted")}
          </span>
          <Toggle
            checked={turnAlerts ?? false}
            onChange={updateTurnAlerts}
            label="Turn notifications"
            disabled={turnAlerts === null || notificationSaving}
          />
        </div>
      </Surface>
    </div>
  );
}

export function InterfaceQuickSettings() {
  const { preferences, updatePreferences } = useBrowserPreferences();

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Surface
        icon={<Sparkles className="h-4 w-4" />}
        title="Reduced motion"
        description="Minimize animated transitions and moving decorative effects."
      >
        <div className="mt-3 flex justify-end">
          <Toggle
            checked={preferences.reducedMotion}
            onChange={(reducedMotion) => updatePreferences({ reducedMotion })}
            label="Reduced motion"
          />
        </div>
      </Surface>
      <Surface
        icon={<Contrast className="h-4 w-4" />}
        title="High contrast"
        description="Strengthen borders, secondary text, and keyboard focus."
      >
        <div className="mt-3 flex justify-end">
          <Toggle
            checked={preferences.highContrast}
            onChange={(highContrast) => updatePreferences({ highContrast })}
            label="High contrast"
          />
        </div>
      </Surface>
      <Surface
        icon={<Languages className="h-4 w-4" />}
        title="Language"
        description="A House Divided currently ships in English."
      >
        <select
          aria-label="Language"
          value={preferences.language}
          disabled
          className="mt-3 min-h-11 w-full rounded-xl border border-card-border bg-card px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-80"
        >
          <option value="en">English</option>
        </select>
      </Surface>
    </div>
  );
}

export function AudioQuickSettings() {
  const { preferences, updatePreferences } = useBrowserPreferences();

  return (
    <div className="rounded-2xl border border-card-border bg-background/45 p-4 md:p-5">
      <div className="flex items-center gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {preferences.gameSounds ? (
            <Volume2 className="h-5 w-5" />
          ) : (
            <VolumeX className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Game Sounds</p>
          <p className="text-xs leading-5 text-muted">
            Controls profile music and future in-game sound cues on this device.
          </p>
        </div>
        <Toggle
          checked={preferences.gameSounds}
          onChange={(gameSounds) => updatePreferences({ gameSounds })}
          label="Game Sounds"
        />
      </div>

      {!preferences.audioCustomized ? (
        <button
          type="button"
          onClick={() => updatePreferences({ audioCustomized: true })}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-card-elevated"
        >
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Customize audio
        </button>
      ) : (
        <div className="mt-5 grid gap-5 border-t border-card-border pt-5 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="master-volume" className="text-sm font-medium text-foreground">
                Master volume
              </label>
              <span className="font-mono text-xs text-muted">{preferences.masterVolume}%</span>
            </div>
            <Slider
              id="master-volume"
              min={0}
              max={100}
              value={preferences.masterVolume}
              disabled={!preferences.gameSounds}
              onChange={(event) =>
                updatePreferences({ masterVolume: Number(event.currentTarget.value) })
              }
              aria-label="Master volume"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-card-border bg-card/70 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Event sounds</p>
              <p className="mt-0.5 text-xs text-muted">
                Controls short cues when a game event provides one.
              </p>
            </div>
            <Toggle
              checked={preferences.eventSounds}
              onChange={(eventSounds) => updatePreferences({ eventSounds })}
              label="Event sounds"
              disabled={!preferences.gameSounds}
            />
          </div>
          <p
            className="flex items-center gap-1.5 text-xs text-success md:col-span-2"
            aria-live="polite"
          >
            <Check className="h-3.5 w-3.5" />
            Saved on this device
          </p>
        </div>
      )}
    </div>
  );
}

const VALID_THEMES = new Set([
  "light",
  "default",
  "oled",
  "usa",
  "pastel",
  "dark-pastel",
  "retro",
  "solarized",
  "cloakroom",
  "broadsheet",
  "coldwar",
]);
const VALID_STATUS_BAR_LAYOUTS = new Set(["standard", "corp", "elections", "full", "minimal"]);

export function DataQuickSettings() {
  const { preferences, replacePreferences, resetPreferences } = useBrowserPreferences();
  const { theme, setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const exportPreferences = () => {
    const savedStatusBarLayout = window.localStorage.getItem("statusBarLayout");
    const payload = {
      format: "ahd-device-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences,
      theme,
      statusBarLayout:
        savedStatusBarLayout && VALID_STATUS_BAR_LAYOUTS.has(savedStatusBarLayout)
          ? savedStatusBarLayout
          : "standard",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ahd-device-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Device settings exported.");
  };

  const importPreferences = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text()) as Record<string, unknown>;
      if (
        imported.statusBarLayout !== undefined &&
        (typeof imported.statusBarLayout !== "string" ||
          !VALID_STATUS_BAR_LAYOUTS.has(imported.statusBarLayout))
      ) {
        throw new Error("invalid status bar layout");
      }
      replacePreferences(parseBrowserPreferences(imported.preferences ?? imported));
      if (typeof imported.theme === "string" && VALID_THEMES.has(imported.theme)) {
        setTheme(imported.theme as Parameters<typeof setTheme>[0]);
      }
      if (typeof imported.statusBarLayout === "string") {
        window.localStorage.setItem("statusBarLayout", imported.statusBarLayout);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "statusBarLayout",
            newValue: imported.statusBarLayout,
          })
        );
        void fetchJson("/api/settings/status-bar", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: imported.statusBarLayout }),
          feature: "settings-device-import-status-bar",
        }).catch(() => {
          setMessage("Imported on this device, but status bar sync failed.");
        });
      }
      setMessage("Device settings imported.");
    } catch {
      setMessage("That file is not a valid AHD settings export.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clearCachedData = async () => {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
    window.sessionStorage.clear();
    setMessage("Temporary browser cache cleared. Your preferences were kept.");
  };

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        <Surface
          icon={<Download className="h-4 w-4" />}
          title="Export settings"
          description="Download this device’s interface and audio preferences."
        >
          <button
            type="button"
            onClick={exportPreferences}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </Surface>
        <Surface
          icon={<Upload className="h-4 w-4" />}
          title="Import settings"
          description="Restore a device-settings JSON file from AHD."
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void importPreferences(event.currentTarget.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-card-elevated"
          >
            <Upload className="h-4 w-4 text-primary" />
            Choose file
          </button>
        </Surface>
        <Surface
          icon={<Database className="h-4 w-4" />}
          title="Browser cache"
          description="Clear temporary cached responses without signing out or losing preferences."
        >
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void clearCachedData()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-card-elevated"
            >
              Clear cache
            </button>
            <button
              type="button"
              onClick={() => {
                resetPreferences();
                setMessage("Device preferences restored to smart defaults.");
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-card hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset preferences
            </button>
          </div>
        </Surface>
      </div>
      {message && (
        <p
          className="mt-3 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-xs text-success"
          aria-live="polite"
        >
          <Check className="h-3.5 w-3.5" />
          {message}
        </p>
      )}
    </div>
  );
}

export function AudioSectionHint() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Music2 className="h-3.5 w-3.5" />
      Profile music is managed below.
    </span>
  );
}
