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
  /**
   * The target's parties, for naming which one rules a one-party state.
   *
   * Loaded from the same helper the route validates against, so a party the
   * victor can pick here is a party the route will accept.
   */
  targetParties: { id: number; name: string; abbreviation?: string }[];
  /**
   * True when this war is carrying a settlement crisis the victor is the CHALLENGER
   * of. Server-decided: the panel cannot tell which war a question is riding, and
   * the route refuses the term from anyone else regardless.
   */
  canDictateReunification?: boolean;
}

type TermKind =
  "white_peace" | "indemnity" | "regime_change" | "demilitarisation" | "reunification";

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
  // Empty string means "let the conversion resolve it", which is what the term
  // does when it names no party.
  const [rulingParty, setRulingParty] = useState<string>("");
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
    if (kind === "white_peace") {
      return submit({ kind: "white_peace" });
    }
    if (kind === "indemnity") {
      return submit({ kind: "indemnity", payer: view.target, amount: Number(amount) || 0 });
    }
    if (kind === "regime_change") {
      // The party rides along only for the system that HAS a ruling party. The
      // route refuses the pairing outright otherwise, so sending it with a
      // republic would turn a stale dropdown into a rejected settlement.
      const named = system === "onePartyState" && rulingParty !== "";
      return submit({
        kind: "regime_change",
        targetSystem: system,
        ...(named ? { rulingPartyId: Number(rulingParty) } : {}),
      });
    }
    if (kind === "reunification") {
      return submit({ kind: "reunification" });
    }
    return submit({ kind: "demilitarisation", turns: Number(turns) || 0 });
  }

  /**
   * End the war taking nothing AND recording no victor.
   *
   * Distinct from an indemnity of zero, which still names a winner. This one says
   * the war settled nothing, which is what releases a question being fought over
   * back to the diplomatic track.
   */
  function whitePeace() {
    return submit({ kind: "white_peace" });
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
          checked={kind === "white_peace"}
          onSelect={() => setKind("white_peace")}
          title="White peace"
          blurb={`The war ends where it began. Neither side is recorded as having won, and nothing changes hands.`}
        >
          <p className="mt-1 text-[11px] text-muted">
            Anything the war was being fought over goes back to being an open question.
          </p>
        </Option>

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
              aria-label="New system"
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

          {system === "onePartyState" && (
            <label className="mt-2 block text-[11px] text-muted">
              Ruling party
              <select
                aria-label="Ruling party"
                value={rulingParty}
                onChange={(e) => setRulingParty(e.target.value)}
                className="mt-1 block w-full rounded border border-card-border bg-card px-2 py-1 text-[12px]"
              >
                <option value="">Let the strongest party take power</option>
                {view.targetParties.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.abbreviation ? `${p.abbreviation} (${p.name})` : p.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block">
                The party you name rules alone. Every other party in {view.targetName} is banned.
                Leave this on the default and the largest bench takes power, which may be the
                government you just fought.
              </span>
            </label>
          )}
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

        {view.canDictateReunification && (
          <Option
            checked={kind === "reunification"}
            onSelect={() => setKind("reunification")}
            title="German reunification"
            blurb={`The German question is settled on your terms: the two German states become one.`}
          >
            <p className="mt-1 text-[11px] text-muted">
              This settles the question itself rather than landing on {view.targetName}. The unified
              state carries the eastern government across, and the crisis closes with it.
            </p>
          </Option>
        )}
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
          Sign a white peace
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
