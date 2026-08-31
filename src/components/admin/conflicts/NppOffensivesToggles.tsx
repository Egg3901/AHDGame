"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { LocalTime } from "@/components/time/LocalTime";

const ENDPOINT = "/api/admin/conflicts/npp-offensives/toggle";

type FlagKey = "initiation" | "join";

interface FlagState {
  enabled: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
}

type FlagsResponse = Record<FlagKey, FlagState>;

const COPY: Record<FlagKey, { title: string; body: string; on: string; off: string }> = {
  initiation: {
    title: "Initiate Offensives",
    body: "Let NPP countries in a conflict declare offensives of their own. While off, an NPP government never queues a battle declaration and spends its foreign policy slot on diplomacy instead.",
    on: "NPP governments may now declare their own offensives.",
    off: "NPP governments will no longer declare offensives.",
  },
  join: {
    title: "Join Offensives",
    body: "Let NPP countries join an ally's offensive at a front where they already have troops posted, the way a player government does with a standing auto join order. While off, NPP allies only ever defend.",
    on: "NPP allies will now join offensives at fronts where they are deployed.",
    off: "NPP allies will no longer join offensives.",
  },
};

/**
 * The two switches that decide whether NPP-run belligerents fight offensively:
 * `nppOffensiveInitiationEnabled` and `nppOffensiveJoinEnabled`. Both default off,
 * and neither affects a player government. Admin-only.
 */
export function NppOffensivesToggles() {
  const [flags, setFlags] = useState<FlagsResponse | null>(null);
  const [busy, setBusy] = useState<FlagKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJson<FlagsResponse>(ENDPOINT, { feature: "admin-npp-offensives-toggle" })
      .then(setFlags)
      .catch(() => setMessage("Could not load the NPP offensive switches."));
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
        // Re-read rather than patch locally, so the attribution the server stamped is
        // what the panel shows.
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
      <h3 className="font-serif text-lg text-foreground">NPP Offensives</h3>
      <p className="mt-0.5 max-w-xl text-sm text-muted">
        Whether countries run by the NPP engine fight offensively in a conflict. Defence is
        automatic for any country with troops at a front and is not affected by either switch.
      </p>

      <div
        role="note"
        className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
      >
        <span className="font-semibold">Warning.</span> Turning either switch on is likely to
        produce more lost offensives. NPP countries have no Generals or military technology system
        yet, so their attacks go in without the command bonuses and research a player run army
        brings, and an attack that fails still costs the casualties and gives ground.
      </div>

      <div className="mt-4 space-y-3">
        {(["initiation", "join"] as FlagKey[]).map((flag) => {
          const state = flags?.[flag];
          const on = state?.enabled === true;
          return (
            <div
              key={flag}
              className="flex flex-col gap-3 rounded-lg border border-card-border bg-background p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <h4 className="font-medium text-foreground">{COPY[flag].title}</h4>
                <p className="mt-0.5 max-w-xl text-sm text-muted">{COPY[flag].body}</p>
                {on && state?.enabledBy && (
                  <p className="mt-2 text-xs text-muted">
                    Enabled by{" "}
                    <span className="font-medium text-foreground">{state.enabledBy}</span>
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
