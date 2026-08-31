"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { LocalTime } from "@/components/time/LocalTime";

const ENDPOINT = "/api/admin/conflicts/npp-intelligence/toggle";

interface FlagState {
  enabled: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
}

interface FlagsResponse {
  operations: FlagState;
}

/**
 * The switch that decides whether NPP-run countries run intelligence operations
 * of their own: `nppIntelligenceOperationsEnabled`. Defaults off, and never
 * affects a player government.
 *
 * Deliberately one switch, not two. Counter-intelligence posture is derived for
 * every NPP country every turn regardless of this, because defence needs no
 * order, so there is no defensive half to gate. Admin-only.
 */
export function NppIntelligenceToggle() {
  const [flags, setFlags] = useState<FlagsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJson<FlagsResponse>(ENDPOINT, { feature: "admin-npp-intelligence-toggle" })
      .then(setFlags)
      .catch(() => setMessage("Could not load the NPP intelligence switch."));
  }, []);

  useEffect(load, [load]);

  async function toggle() {
    if (!flags || busy) return;
    setBusy(true);
    setMessage(null);
    const next = !flags.operations.enabled;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(
          next
            ? "NPP governments will now build networks and run operations of their own."
            : "NPP governments will no longer run intelligence operations."
        );
        // Apply locally first, then re-read for the attribution the server stamped.
        setFlags((current) =>
          current ? { operations: { ...current.operations, enabled: next } } : current
        );
        load();
      } else {
        setMessage(data.error ?? "Failed to update the switch.");
      }
    } catch {
      setMessage("Failed to update the switch.");
    } finally {
      setBusy(false);
    }
  }

  const state = flags?.operations;
  const on = state?.enabled === true;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <h3 className="font-serif text-lg text-foreground">NPP Intelligence Operations</h3>
      <p className="mt-0.5 max-w-xl text-sm text-muted">
        Whether countries run by the NPP engine build intelligence networks and run operations of
        their own. Counter-intelligence is automatic for every country either way, so a country
        nobody is playing still resists being spied on.
      </p>

      <div
        role="note"
        className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
      >
        <span className="font-semibold">Warning.</span> Turning this on points the whole NPP world
        at your players. An operation that is traced back raises tension and can open a crisis, and
        NPP services pick their targets without a player weighing the diplomatic cost.
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-card-border bg-background p-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="font-medium text-foreground">Run Operations</h4>
          <p className="mt-0.5 max-w-xl text-sm text-muted">
            Let NPP countries fund networks abroad and run collection and covert action. While off,
            an NPP service holds no networks and runs nothing.
          </p>
          {on && state?.enabledBy && (
            <p className="mt-2 text-xs text-muted">
              Enabled by <span className="font-medium text-foreground">{state.enabledBy}</span>
              {state.enabledAt ? (
                <>
                  {" "}
                  on <LocalTime value={state.enabledAt} />
                </>
              ) : (
                ""
              )}
              .
            </p>
          )}
        </div>
        <button
          onClick={toggle}
          disabled={!flags || busy}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            on
              ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-card-border bg-card text-muted hover:bg-card-border/20"
          }`}
          title="Toggle NPP intelligence operations on or off."
        >
          {!flags ? "Loading…" : `${on ? "Enabled" : "Disabled"}${busy ? "…" : ""}`}
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-muted">{message}</p>}
    </div>
  );
}
