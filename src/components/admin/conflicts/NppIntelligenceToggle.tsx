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
  sabotage: FlagState;
}

type FlagKey = "operations" | "sabotage";

const COPY: Record<FlagKey, { title: string; body: string; on: string; off: string }> = {
  operations: {
    title: "Run Operations",
    body: "Let NPP countries fund networks abroad and run collection and covert action. While off, an NPP service holds no networks and runs nothing.",
    on: "NPP governments are cleared to run intelligence operations once that behaviour ships.",
    off: "NPP governments will not run intelligence operations.",
  },
  sabotage: {
    title: "Military Sabotage Effects",
    body: "Let a successful military covert action actually cut a front's supply and wear down formations. While off the operation still runs, still costs, and still risks being traced, but lands on nothing.",
    on: "Military sabotage now has real effects. Watch the fronts.",
    off: "Military sabotage is inert again.",
  },
};

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
  const [busy, setBusy] = useState<FlagKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJson<FlagsResponse>(ENDPOINT, { feature: "admin-npp-intelligence-toggle" })
      .then(setFlags)
      .catch(() => setMessage("Could not load the NPP intelligence switch."));
  }, []);

  useEffect(load, [load]);

  async function toggle(flag: FlagKey) {
    if (!flags || busy) return;
    setBusy(flag);
    setMessage(null);
    const next = !flags[flag].enabled;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag, enabled: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(next ? COPY[flag].on : COPY[flag].off);
        // Apply locally first, then re-read for the attribution the server stamped.
        setFlags((current) =>
          current ? { ...current, [flag]: { ...current[flag], enabled: next } } : current
        );
        load();
      } else {
        setMessage(data.error ?? "Failed to update the switch.");
      }
    } catch {
      setMessage("Failed to update the switch.");
    } finally {
      setBusy(null);
    }
  }

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
        <span className="font-semibold">Not yet active.</span> NPP services do not run operations of
        their own yet, so this switch changes nothing today. It is the gate for when they do, and it
        ships off so that behaviour can never arrive switched on by surprise. Counter intelligence
        is already live for every country regardless of this setting.
      </div>

      <div className="mt-4 space-y-3">
        {(["operations", "sabotage"] as FlagKey[]).map((flag) => {
          const st = flags?.[flag];
          const on = st?.enabled === true;
          return (
            <div
              key={flag}
              className="flex flex-col gap-3 rounded-lg border border-card-border bg-background p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <h4 className="font-medium text-foreground">{COPY[flag].title}</h4>
                <p className="mt-0.5 max-w-xl text-sm text-muted">{COPY[flag].body}</p>
                {flag === "sabotage" && (
                  <p className="mt-2 max-w-xl text-xs text-muted">
                    Held back deliberately. How much a sabotaged front should suffer is a balance
                    question, and there is no war running to measure it against yet.
                  </p>
                )}
                {on && st?.enabledBy && (
                  <p className="mt-2 text-xs text-muted">
                    Enabled by <span className="font-medium text-foreground">{st.enabledBy}</span>
                    {st.enabledAt ? (
                      <>
                        {" "}
                        on <LocalTime value={st.enabledAt} />
                      </>
                    ) : (
                      ""
                    )}
                    .
                  </p>
                )}
              </div>
              <button
                onClick={() => toggle(flag)}
                disabled={!flags || busy !== null}
                className={`inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  on
                    ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-card-border bg-card text-muted hover:bg-card-border/20"
                }`}
                title={`Toggle ${COPY[flag].title} on or off.`}
              >
                {!flags ? "Loading…" : `${on ? "Enabled" : "Disabled"}${busy === flag ? "…" : ""}`}
              </button>
            </div>
          );
        })}
      </div>

      {message && <p className="mt-3 text-sm text-muted">{message}</p>}
    </div>
  );
}
