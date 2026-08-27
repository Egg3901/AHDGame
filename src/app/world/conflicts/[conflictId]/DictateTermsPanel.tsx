"use client";

import { useState } from "react";
import { MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

export interface DictateTermsView {
  conflictId: string;
  /** The imposing country's code, lower-cased for the route path. */
  countryCode: string;
  /** The country the term lands on. */
  target: string;
  targetName: string;
  turnsLeft: number;
}

type TermKind = "indemnity" | "regime_change" | "demilitarisation";

/** Systems a settlement may install. A crown cannot be created by treaty. */
const SYSTEMS = [
  { id: "parliamentaryRepublic", label: "Parliamentary republic" },
  { id: "presidential", label: "Presidential republic" },
  { id: "onePartyState", label: "One-party state" },
] as const;

/**
 * Name the terms of a war won outright.
 *
 * Rendered ONLY for the winning principal's negotiator: the server returns null for
 * everyone else, so a coalition's allies and the losing side never see it. The route
 * enforces the same rule, so this is a surface for a decision that is already
 * authorized rather than the thing granting it.
 *
 * ONE TERM. The radio group is the whole point: the payload is a discriminated union
 * server-side, so two terms cannot be sent even by a hand-rolled request.
 *
 * Player-facing copy throughout, so no em or en dashes and durations in turns.
 */
export function DictateTermsPanel({ view }: { view: DictateTermsView }) {
  const [kind, setKind] = useState<TermKind>("indemnity");
  const [amount, setAmount] = useState("0");
  const [system, setSystem] = useState<string>("parliamentaryRepublic");
  const [turns, setTurns] = useState("240");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(term: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${view.countryCode}/executive/conflicts/${view.conflictId}/terms`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That could not be imposed.");
        return;
      }
      window.location.reload();
    } catch {
      setError("That could not be imposed.");
    } finally {
      setBusy(false);
    }
  }

  function impose() {
    if (kind === "indemnity") {
      return submit({ kind: "indemnity", payer: view.target, amount: Number(amount) || 0 });
    }
    if (kind === "regime_change") {
      return submit({ kind: "regime_change", targetSystem: system });
    }
    return submit({ kind: "demilitarisation", turns: Number(turns) || 0 });
  }

  /** End the war taking nothing. The same mechanism dialled to zero. */
  function whitePeace() {
    return submit({ kind: "indemnity", payer: view.target, amount: 0 });
  }

  return (
    <section className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p style={{ font: `600 13px ${mono}` }} className="text-warning">
        THE WAR IS WON. NAME YOUR TERMS.
      </p>
      <p className="mt-1 text-[12px] text-muted">
        {view.targetName} has no ground left to hold. You may impose one term. This window closes in{" "}
        {view.turnsLeft} {view.turnsLeft === 1 ? "turn" : "turns"}, after which the war ends with no
        terms taken.
      </p>

      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Term imposed on {view.targetName}</legend>

        <Option
          checked={kind === "indemnity"}
          onSelect={() => setKind("indemnity")}
          title="Indemnity"
          blurb={`${view.targetName} pays a reparation, in its own currency.`}
        >
          <label className="mt-1 block text-[11px] text-muted">
            Amount
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded border border-card-border bg-card px-2 py-1 text-[12px]"
            />
          </label>
        </Option>

        <Option
          checked={kind === "regime_change"}
          onSelect={() => setKind("regime_change")}
          title="Regime change"
          blurb={`${view.targetName} changes its system of government. Its legislature is dissolved and fresh elections are called.`}
        >
          <label className="mt-1 block text-[11px] text-muted">
            New system
            <select
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              className="mt-1 block w-full rounded border border-card-border bg-card px-2 py-1 text-[12px]"
            >
              {SYSTEMS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </Option>

        <Option
          checked={kind === "demilitarisation"}
          onSelect={() => setKind("demilitarisation")}
          title="Demilitarisation"
          blurb={`${view.targetName} may award no new defence contracts. Existing orders keep delivering.`}
        >
          <label className="mt-1 block text-[11px] text-muted">
            Turns
            <input
              type="number"
              min={1}
              value={turns}
              onChange={(e) => setTurns(e.target.value)}
              className="mt-1 block w-full rounded border border-card-border bg-card px-2 py-1 text-[12px]"
            />
          </label>
        </Option>
      </fieldset>

      {error && <p className="mt-2 text-[12px] text-error">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={impose}
          className="rounded bg-error px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          Impose terms
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={whitePeace}
          className="rounded border border-card-border px-3 py-1.5 text-[12px] text-muted disabled:opacity-50"
        >
          End the war with no terms
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Terms are final once imposed. {view.targetName} is notified and the term is written onto
        this war record.
      </p>
    </section>
  );
}

function Option({
  checked,
  onSelect,
  title,
  blurb,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded border p-2 ${
        checked ? "border-warning bg-warning/10" : "border-card-border bg-card"
      }`}
    >
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="peace-term"
          checked={checked}
          onChange={onSelect}
          className="mt-1"
        />
        <span>
          <span className="block text-[12px] font-semibold">{title}</span>
          <span className="block text-[11px] text-muted">{blurb}</span>
        </span>
      </label>
      {checked && <div className="pl-6">{children}</div>}
    </div>
  );
}
