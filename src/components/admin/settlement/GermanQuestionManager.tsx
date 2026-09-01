"use client";

import { useCallback, useEffect, useState } from "react";
import { HUNDREDTHS, SETTLEMENT_RULE_KEYS } from "@/lib/constants/settlementCrisis";

/**
 * Admin surface for the German Question.
 *
 * Operational density, not game density: no hero, no meter art. The board the
 * players see lives at `/world/german-question`; this is the levers the design
 * calls for — open, close, force-resolve, set a position, flip a rule — plus
 * enough state to tell whether pressing them will do anything.
 *
 * Opening is admin-only by design: nothing in the turn loop ever creates a
 * settlement crisis, so this panel is the only door.
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
  nextBriefingTurn: number;
  postedWireEvents: string[];
  rules: RulesState;
  institutions: InstitutionRow[];
}

interface AdminState {
  enabled: boolean;
  currentTurn: number;
  /** Set when opening now would freeze the question onto a war already running. */
  openWarning: string | null;
  crisis: CrisisState | null;
  history: {
    id: string;
    status: string;
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
  const [warning, setWarning] = useState<string | null>(null);
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
    setWarning(null);
    try {
      const res = await fetch("/api/admin/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        note?: string;
        warning?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "The action was refused.");
        return;
      }
      setMessage(data?.note ? `${ok} ${data.note}` : ok);
      // Its own state, not appended to the success line: the action DID succeed,
      // and a caution about what the next tick will do to it reads as neither a
      // success nor a failure.
      if (data?.warning) setWarning(data.warning);
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
          the Warsaw Pact. It is started from here and nowhere else — the turn loop advances a live
          crisis but never creates one.
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
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
            <dt className="text-xs tracking-wide text-muted uppercase">Status</dt>
            <dd className="text-foreground">{crisis ? crisis.status : "none live"}</dd>
          </div>
        </dl>
        {!state?.enabled && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
            The <code>settlementCrisisEnabled</code> gate is off, so the turn phase will not tick
            this crisis even after you open it. Flip it on the Dashboard&apos;s Feature Gates panel
            first.
          </p>
        )}
      </section>

      {message && (
        <p className="rounded-md border border-success/40 bg-success/10 p-2.5 text-sm text-success">
          {message}
        </p>
      )}
      {warning && (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning"
        >
          {warning}
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
          {state?.openWarning && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning"
            >
              {state.openWarning}
            </p>
          )}
          <p className="mt-0.5 max-w-2xl text-sm text-muted">
            Nothing opens this on its own — the turn loop only advances a crisis that already
            exists. Open it whenever you judge the moment right. It will refuse only if a crisis is
            already live, if a resolved one has not been enacted yet, or if the two Germanies are no
            longer separate states.
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void post({ action: "open" }, "Opened.")}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              Open the German Question
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
                {crisis.conflictId ? ` · conflict ${crisis.conflictId}` : ""} · next World News
                briefing T-{crisis.nextBriefingTurn}
                {crisis.postedWireEvents.length > 0
                  ? ` · filed: ${crisis.postedWireEvents.join(", ")}`
                  : ""}
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

          <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
            <h4 className="font-semibold text-foreground">Close the question</h4>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Calls it off as though it was never asked. No winner, no absorption, no history entry
              against either Germany — the next tick simply finds nothing live, and you can open it
              again straight away.
              {crisis.status === "frozen" && (
                <>
                  {" "}
                  <strong className="text-warning">
                    This crisis has already declared a war. Closing it does not end that conflict
                    {crisis.conflictId ? ` (${crisis.conflictId})` : ""} — deal with it on the
                    Conflicts board.
                  </strong>
                </>
              )}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Money and actions already spent are <strong>not</strong> refunded. Those were real
              debits taken turn by turn; unwinding them is a separate operation.
            </p>
            <div className="mt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void post({ action: "close" }, "Closed.")}
                className="rounded-lg border border-card-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-card-muted disabled:opacity-50"
              >
                Close the German Question
              </button>
            </div>
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
                Reunification carries — the GDR absorbs the Federal Republic
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
                T-{h.resolvedTurn ?? "?"} ·{" "}
                {h.status === "cancelled"
                  ? "closed without a decision — free to reopen"
                  : `${h.outcome ?? "no outcome"} · ${
                      h.cooldownUntilTurn == null
                        ? "awaiting actuation — cannot reopen yet"
                        : `settled; free to reopen (advisory: T-${h.cooldownUntilTurn})`
                    }`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
