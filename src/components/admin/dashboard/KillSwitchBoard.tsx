"use client";

import { useCallback, useEffect, useState } from "react";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { Skeleton } from "@/components/ui";

type MaintenanceMode = "off" | "partial" | "full";

/** Switches whose state is a simple `{ enabled }` GET + PATCH on one URL. */
interface PatchSwitchDef {
  key: string;
  kind: "patch";
  url: string;
  label: string;
  desc: string;
  /** Confirm before switching TO this value (true = enabling, false = disabling). */
  confirmWhen?: boolean;
  confirmText?: string;
  /** Which state counts as "on" for display; some switches read inverted. */
  onLabel?: string;
  offLabel?: string;
}

/** Switches backed by the turn-state POST toggles; current value comes from
 * the shared /api/game/turn/status snapshot. */
interface TurnSwitchDef {
  key: "fast" | "events" | "corp" | "transfers" | "free-party-moves";
  kind: "turn";
  url: string;
  label: string;
  desc: string;
  confirmWhen?: boolean;
  confirmText?: string;
  onLabel?: string;
  offLabel?: string;
  /** POST `{ enabled: <target> }` instead of an empty body (the PREE toggle
   * route validates a JSON body; the turn-state toggles take none). */
  sendsTarget?: boolean;
}

type SwitchDef = PatchSwitchDef | TurnSwitchDef;

const SWITCHES: SwitchDef[] = [
  {
    key: "registration",
    kind: "patch",
    url: "/api/admin/registration",
    label: "Registration",
    desc: "Master kill-switch for all new player sign-ups (email, Google, Discord).",
    confirmWhen: false,
    confirmText: "Close registration? New players will be unable to sign up.",
    onLabel: "Open",
    offLabel: "Closed",
  },
  {
    key: "ip-collision",
    kind: "patch",
    url: "/api/admin/ip-collision-check",
    label: "IP collision check",
    desc: "Block sign-ups reusing an existing IP, cookie, or device fingerprint.",
  },
  {
    key: "test-mode",
    kind: "patch",
    url: "/api/admin/test-mode",
    label: "Test mode",
    desc: "Registration requires the TEST_SECRET to proceed.",
    confirmWhen: true,
    confirmText: "Enable test mode? Normal registration will require the TEST_SECRET.",
  },
  {
    key: "fast",
    kind: "turn",
    url: "/api/admin/turn/toggle-fast-mode",
    label: "Fast mode",
    desc: "30-minute turn cycles instead of 60.",
  },
  {
    key: "events",
    kind: "turn",
    url: "/api/admin/events/pree/toggle",
    label: "Random events",
    desc: "Approved event templates fire for players each turn cycle.",
    sendsTarget: true,
    confirmWhen: true,
    confirmText:
      "Enable player random events? Approved templates will begin firing on the next turn cycle.",
  },
  {
    key: "corp",
    kind: "turn",
    url: "/api/admin/turn/toggle-corporation-actions",
    label: "Corporation actions",
    desc: "Sector splits and attacks (share trading stays allowed).",
    onLabel: "Allowed",
    offLabel: "Paused",
  },
  {
    key: "transfers",
    kind: "turn",
    url: "/api/admin/turn/toggle-player-transfers",
    label: "Player transfers",
    desc: "Player-to-player money transfers.",
    onLabel: "Allowed",
    offLabel: "Paused",
  },
  {
    key: "free-party-moves",
    kind: "turn",
    url: "/api/admin/turn/toggle-free-party-moves",
    label: "Free party moves",
    desc: "Each player gets one cooldown-free party switch. Open while staging a launch, close at go-live.",
    onLabel: "Open",
    offLabel: "Closed",
  },
  {
    key: "public-read",
    kind: "patch",
    url: "/api/admin/config/public-review-mode",
    label: "Public read-only",
    desc: "Anonymous browsing of world state without an account.",
  },
  {
    key: "public-viewing",
    kind: "patch",
    url: "/api/admin/config/public-viewing",
    label: "Public viewing",
    desc: "Internal API read-gate against anonymous scraping.",
  },
  {
    key: "regional",
    kind: "patch",
    url: "/api/admin/config/regional-conditions-overview",
    label: "Regional conditions",
    desc: "Condition chips on the state overview page.",
  },
  {
    key: "first-joiner-chair",
    kind: "patch",
    url: "/api/admin/party/first-joiner-chair",
    label: "Auto-assign vacant chair",
    desc: "First joiner of a chairless party org becomes chair.",
  },
];

const MAINTENANCE_META: Record<MaintenanceMode, { pill: string; cls: string }> = {
  off: { pill: "Off", cls: "bg-success/15 text-success" },
  partial: { pill: "Partial", cls: "bg-warning/15 text-warning" },
  full: { pill: "Full", cls: "bg-error/15 text-error" },
};

/** Segmented-button styling per maintenance mode: idle / active. */
const MAINTENANCE_MODES: { mode: MaintenanceMode; label: string; activeCls: string }[] = [
  { mode: "off", label: "Off", activeCls: "border-success/50 bg-success/15 text-success" },
  { mode: "partial", label: "Partial", activeCls: "border-warning/50 bg-warning/15 text-warning" },
  { mode: "full", label: "Full", activeCls: "border-error/50 bg-error/15 text-error" },
];

/** Every global kill-switch in one grid — replaces the nine single-purpose
 * dashboard panels. Simple `{enabled}` switches PATCH their config route;
 * turn-state switches POST their toggle route and re-read turn status. */
export function KillSwitchBoard() {
  const turnStatus = useGameTurnStatus();
  const [patchState, setPatchState] = useState<Record<string, boolean | null>>({});
  const [maintenance, setMaintenance] = useState<MaintenanceMode | null>(null);
  // Local echo of turn-state switches after a toggle, ahead of the next poll.
  const [turnEcho, setTurnEcho] = useState<Partial<Record<TurnSwitchDef["key"], boolean>>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    const patchDefs = SWITCHES.filter((s): s is PatchSwitchDef => s.kind === "patch");
    const results = await Promise.allSettled([
      fetch("/api/admin/maintenance", { credentials: "same-origin" }).then((r) =>
        r.ok ? r.json() : null
      ),
      ...patchDefs.map((s) =>
        fetch(s.url, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null))
      ),
    ]);
    const [maint, ...rest] = results;
    if (maint.status === "fulfilled" && maint.value?.mode) {
      setMaintenance(maint.value.mode as MaintenanceMode);
    }
    const next: Record<string, boolean | null> = {};
    patchDefs.forEach((s, i) => {
      const r = rest[i];
      next[s.key] =
        r.status === "fulfilled" && typeof r.value?.enabled === "boolean" ? r.value.enabled : null;
    });
    setPatchState(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const turnValue = (key: TurnSwitchDef["key"]): boolean | null => {
    if (turnEcho[key] !== undefined) return turnEcho[key] ?? null;
    if (!turnStatus) return null;
    switch (key) {
      case "fast":
        return turnStatus.fastMode ?? null;
      case "events":
        return turnStatus.playerRandomEventsEnabled ?? null;
      case "corp":
        return turnStatus.corporationActionsPaused === undefined
          ? null
          : !turnStatus.corporationActionsPaused;
      case "transfers":
        return turnStatus.playerTransfersPaused === undefined
          ? null
          : !turnStatus.playerTransfersPaused;
      case "free-party-moves":
        // Already "true = open", so no inversion (unlike the *Paused flags).
        return turnStatus.freePartyMovesOpen ?? null;
    }
  };

  const refreshTurnEcho = async () => {
    try {
      const res = await fetch("/api/game/turn/status", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setTurnEcho({
        fast: d.fastMode ?? undefined,
        events: d.playerRandomEventsEnabled ?? undefined,
        corp: d.corporationActionsPaused === undefined ? undefined : !d.corporationActionsPaused,
        transfers: d.playerTransfersPaused === undefined ? undefined : !d.playerTransfersPaused,
        "free-party-moves": d.freePartyMovesOpen ?? undefined,
      });
    } catch {
      // Next shared poll will catch up.
    }
  };

  const toggleSwitch = async (def: SwitchDef) => {
    const current = def.kind === "patch" ? patchState[def.key] : turnValue(def.key);
    if (current === null || current === undefined || busyKey) return;
    const target = !current;
    if (def.confirmWhen !== undefined && target === def.confirmWhen && def.confirmText) {
      if (!confirm(def.confirmText)) return;
    }
    setBusyKey(def.key);
    setError("");
    try {
      const res =
        def.kind === "patch"
          ? await fetch(def.url, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: target }),
            })
          : def.sendsTarget
            ? await fetch(def.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: target }),
              })
            : await fetch(def.url, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed to toggle ${def.label}`);
        return;
      }
      if (def.kind === "patch") {
        setPatchState((prev) => ({ ...prev, [def.key]: target }));
      } else {
        await refreshTurnEcho();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusyKey(null);
    }
  };

  const setMaintenanceMode = async (target: MaintenanceMode) => {
    if (maintenance === null || busyKey || target === maintenance) return;
    const messages: Record<MaintenanceMode, string> = {
      off: "Disable maintenance mode and return to normal operation?",
      partial: "Set PARTIAL maintenance? New registrations will be blocked.",
      full: "Set FULL maintenance? The site will be locked for all players.",
    };
    if (!confirm(messages[target])) return;
    let reason: string | undefined;
    if (target !== "off") {
      reason = prompt("Maintenance reason shown to players (optional):", "")?.trim() || undefined;
    }
    setBusyKey("maintenance");
    setError("");
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { mode: target, reason } : { mode: target }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to update maintenance mode");
        return;
      }
      setMaintenance(target);
    } catch {
      setError("Network error");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="rounded-lg border border-card-border bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-card-border px-4 py-3">
        <h2 className="text-body font-bold">Kill-switch board</h2>
        <span className="text-body-sm text-muted">
          every global toggle, one grid — click a card to flip it
        </span>
      </div>
      {error && (
        <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-body-sm text-error">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {/* Maintenance is 3-state, rendered first as the most drastic switch.
            Direct mode picker instead of a click-to-cycle card. */}
        <MaintenanceCard
          mode={maintenance}
          busy={busyKey === "maintenance"}
          loaded={loaded}
          onSelect={setMaintenanceMode}
        />
        {SWITCHES.map((def) => {
          const value = def.kind === "patch" ? patchState[def.key] : turnValue(def.key);
          return (
            <SwitchCard
              key={def.key}
              label={def.label}
              desc={def.desc}
              pill={
                value === null || value === undefined
                  ? undefined
                  : value
                    ? (def.onLabel ?? "On")
                    : (def.offLabel ?? "Off")
              }
              pillCls={
                value === null || value === undefined
                  ? undefined
                  : value
                    ? "bg-success/15 text-success"
                    : "bg-muted/15 text-muted"
              }
              on={value === true}
              busy={busyKey === def.key}
              loaded={loaded || def.kind === "turn"}
              onClick={() => toggleSwitch(def)}
            />
          );
        })}
      </div>
    </section>
  );
}

function MaintenanceCard({
  mode,
  busy,
  loaded,
  onSelect,
}: {
  mode: MaintenanceMode | null;
  busy: boolean;
  loaded: boolean;
  onSelect: (mode: MaintenanceMode) => void;
}) {
  if (!loaded) {
    return (
      <div className="rounded-lg border border-card-border bg-card-muted/50 p-3">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }
  const on = mode !== null && mode !== "off";
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-3 ${
        on ? "border-error/40 bg-error/5" : "border-card-border bg-card-muted/50"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-semibold text-foreground">Maintenance mode</span>
        <span
          className={`shrink-0 rounded-full px-2 py-px text-body-xs font-bold tracking-wider uppercase ${
            mode ? MAINTENANCE_META[mode].cls : "bg-muted/15 text-muted"
          }`}
        >
          {busy ? "…" : mode ? MAINTENANCE_META[mode].pill : "—"}
        </span>
      </span>
      <span className="text-body-xs leading-relaxed text-muted">
        Off = normal · partial blocks registration · full locks the site.
      </span>
      <div className="mt-0.5 flex gap-1.5" role="group" aria-label="Set maintenance mode">
        {MAINTENANCE_MODES.map(({ mode: m, label, activeCls }) => (
          <button
            key={m}
            type="button"
            onClick={() => onSelect(m)}
            disabled={busy || mode === null}
            aria-pressed={mode === m}
            className={`flex-1 cursor-pointer rounded-md border px-2 py-1 text-body-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === m
                ? activeCls
                : "border-card-border text-muted hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SwitchCard({
  label,
  desc,
  pill,
  pillCls,
  on,
  danger,
  busy,
  loaded,
  onClick,
}: {
  label: string;
  desc: string;
  pill?: string;
  pillCls?: string;
  on: boolean;
  danger?: boolean;
  busy: boolean;
  loaded: boolean;
  onClick: () => void;
}) {
  if (!loaded) {
    return (
      <div className="rounded-lg border border-card-border bg-card-muted/50 p-3">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }
  const unknown = pill === undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || unknown}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        on
          ? danger
            ? "border-error/40 bg-error/5 hover:border-error/60"
            : "border-success/30 bg-card-muted/50 hover:border-success/50"
          : "border-card-border bg-card-muted/50 hover:border-foreground/25"
      }`}
      aria-pressed={on}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-semibold text-foreground">{label}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-px text-body-xs font-bold tracking-wider uppercase ${
            unknown ? "bg-muted/15 text-muted" : pillCls
          }`}
        >
          {busy ? "…" : unknown ? "—" : pill}
        </span>
      </span>
      <span className="text-body-xs leading-relaxed text-muted">{desc}</span>
    </button>
  );
}
