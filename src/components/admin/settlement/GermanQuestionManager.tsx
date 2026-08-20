"use client";

import { useCallback, useEffect, useState } from "react";
import { HUNDREDTHS, SETTLEMENT_RULE_KEYS } from "@/lib/constants/settlementCrisis";

/**
 * Admin surface for the German Question.
 *
 * Operational density, not game density: no hero, no meter art. The board the
 * players see lives at `/world/german-question`; this is the four levers the
 * design calls for — force-open, force-resolve, set a position, flip a rule —
 * plus enough state to tell whether pressing them will do anything.
 */
interface InstitutionRow {
  id: string;
  name: string;
  weight: number;
  position: number;
}

interface RulesState {
  openLog: boolean;
  driftRevealed: boolean;
  escalationEnabled: boolean;
}

interface CrisisState {
  id: string;
  status: string;
  position: number;
  heat: number;
  openedTurn: number;
  conflictId: string | null;
  rules: RulesState;
  institutions: InstitutionRow[];
}

interface AdminState {
  enabled: boolean;
  currentTurn: number;
  year: number | null;
  crisis: CrisisState | null;
  history: {
    id: string;
    outcome: string | null;
    resolvedTurn: number | null;
    cooldownUntilTurn: number | null;
  }[];
}

const RULE_LABELS: Record<string, string> = {
  openLog: "Open log — the wire carries pending commitments, not just resolved ones",
  driftRevealed: "Drift revealed — publish Bonn's noise band",
  escalationEnabled: "Escalation enabled — the ladder is in play",
};

const pts = (hundredths: number) => (hundredths / HUNDREDTHS).toFixed(1);

export function GermanQuestionManager() {
  const [state, setState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settlement");
      if (!res.ok) {
        setError("Could not read the settlement state.");
        return;
      }
      const data = (await res.json()) as AdminState;
      setState(data);
      setDrafts(
        Object.fromEntries((data.crisis?.institutions ?? []).map((i) => [i.id, pts(i.position)]))
      );
      setError(null);
    } catch {
      setError("Could not read the settlement state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; note?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "The action was refused.");
        return;
      }
      setMessage(data?.note ? `${ok} ${data.note}` : ok);
      await load();
    } catch {
      setError("The action could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading the settlement board…</p>;
  }

  const crisis = state?.crisis ?? null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h3 className="font-serif text-lg text-foreground">The German Question</h3>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          The settlement crisis over whether West Germany stays sovereign in NATO or reunifies into
          the Warsaw Pact. Opens on its own each tick while the gate is on and the world is in era;
          these controls are for forcing and for testing.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs tracking-wide text-muted uppercase">Feature gate</dt>
            <dd className={state?.enabled ? "text-success" : "text-error"}>
              {state?.enabled ? "On" : "Off"}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-muted uppercase">Turn</dt>
            <dd className="text-foreground">{state?.currentTurn ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-muted uppercase">Year</dt>
            <dd className="text-foreground">{state?.year ?? "unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-muted uppercase">Status</dt>
            <dd className="text-foreground">{crisis ? crisis.status : "none live"}</dd>
          </div>
        </dl>
        {!state?.enabled && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
            The <code>settlementCrisisEnabled</code> gate is off, so the turn phase will not tick
            this crisis even if you force it open. Flip it on the Dashboard&apos;s Feature Gates
            panel first.
          </p>
        )}
      </section>

      {message && (
        <p className="rounded-md border border-success/40 bg-success/10 p-2.5 text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error/40 bg-error/10 p-2.5 text-sm text-error"
        >
          {error}
        </p>
      )}

      {!crisis ? (
        <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
          <h4 className="font-semibold text-foreground">Open the question</h4>
          <p className="mt-0.5 text-sm text-muted">
            &ldquo;Open now&rdquo; runs the same gate the turn phase runs — era window, re-open
            cooldown, both Germanies still separate — and tells you which one refused.
            &ldquo;Force&rdquo; skips the era and cooldown checks but still refuses a second live
            crisis.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void post({ action: "open", force: false }, "Opened.")}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              Open now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void post({ action: "open", force: true }, "Force-opened.")}
              className="rounded-lg border border-warning/50 px-3 py-1.5 text-sm font-semibold text-warning hover:bg-warning/10 disabled:opacity-50"
            >
              Force open
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-semibold text-foreground">Institutions</h4>
              <p className="font-mono text-xs text-muted">
                index {pts(crisis.position)} · heat {crisis.heat} · opened T-{crisis.openedTurn}
                {crisis.conflictId ? ` · conflict ${crisis.conflictId}` : ""}
              </p>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              Points toward reunification, 0–100. The index is a weighted mean and is recomputed
              from these — it is never set directly.
            </p>
            <ul className="mt-3 space-y-2">
              {crisis.institutions.map((inst) => (
                <li key={inst.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[10rem] text-sm text-foreground">{inst.name}</span>
                  <span className="font-mono text-xs text-muted">×{inst.weight}</span>
                  <label className="sr-only" htmlFor={`pos-${inst.id}`}>
                    {inst.name} position
                  </label>
                  <input
                    id={`pos-${inst.id}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={drafts[inst.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [inst.id]: e.target.value }))}
                    className="w-24 rounded-md border border-card-border bg-background px-2 py-1 font-mono text-sm text-foreground"
                  />
                  <button
                    type="button"
                    disabled={busy || drafts[inst.id] === pts(inst.position)}
                    onClick={() =>
                      void post(
                        {
                          action: "setPosition",
                          institutionId: inst.id,
                          points: Number(drafts[inst.id]),
                        },
                        `${inst.name} set.`
                      )
                    }
                    className="rounded-md border border-card-border px-2.5 py-1 text-sm text-foreground hover:bg-card-muted disabled:opacity-40"
                  >
                    Set
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
            <h4 className="font-semibold text-foreground">Rules</h4>
            <ul className="mt-2 space-y-2">
              {SETTLEMENT_RULE_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2.5">
                  <input
                    id={`rule-${key}`}
                    type="checkbox"
                    checked={crisis.rules[key]}
                    disabled={busy}
                    onChange={(e) =>
                      void post(
                        { action: "setRule", key, value: e.target.checked },
                        `${key} ${e.target.checked ? "on" : "off"}.`
                      )
                    }
                    className="mt-0.5"
                  />
                  <label htmlFor={`rule-${key}`} className="text-sm text-foreground">
                    {RULE_LABELS[key] ?? key}
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-error/30 bg-error/[0.03] p-4">
            <h4 className="font-semibold text-foreground">Force a resolution</h4>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Writes the outcome and stops. Actuation — the absorption on a reunification win, the
              history entries, the cooldown — runs on the next turn tick through exactly the same
              path a resolution the players earned would take.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void post({ action: "resolve", outcome: "incumbent" }, "Resolved for Bonn.")
                }
                className="rounded-lg border border-info/50 px-3 py-1.5 text-sm font-semibold text-info hover:bg-info/10 disabled:opacity-50"
              >
                West holds — status quo
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void post(
                    { action: "resolve", outcome: "challenger" },
                    "Resolved for reunification."
                  )
                }
                className="rounded-lg border border-error/50 px-3 py-1.5 text-sm font-semibold text-error hover:bg-error/10 disabled:opacity-50"
              >
                Reunification carries — absorbs the GDR
              </button>
            </div>
          </section>
        </>
      )}

      {(state?.history.length ?? 0) > 0 && (
        <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
          <h4 className="font-semibold text-foreground">Closed questions</h4>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
            {state!.history.map((h) => (
              <li key={h.id}>
                T-{h.resolvedTurn ?? "?"} · {h.outcome ?? "no outcome"} ·{" "}
                {h.cooldownUntilTurn == null
                  ? "awaiting actuation"
                  : `reopens at T-${h.cooldownUntilTurn}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
