"use client";

import { useEffect, useState } from "react";
import { SectionCard, Badge } from "../dossier";
import { WAR_GOALS, WAR_DECLARATION_COOLDOWN_TURNS } from "@/lib/military/warGoals";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useEnabledCountryIds } from "@/lib/hooks/useEnabledCountryIds";
import { fetchJson } from "@/lib/observability/fetchJson";
import { BILL_PROPOSE_ACTION_COST } from "@shared/constants/legislation";

/**
 * The executive's declaration of war.
 *
 * This is the only surface that reaches `/executive/declare-war`. It sits in the
 * defence seat's office rather than on the legislature floor because the ordinary
 * proposal path requires a seated legislator — which a president is not — and the
 * cabinet-bill path is enabled for Japan alone.
 *
 * Passing this control does NOT start a war: it files a bill the chambers must
 * ratify at two-thirds. The copy says so, because a button labelled "declare war"
 * that instead opens a debate would misrepresent what the click does.
 */
export function DeclareWarPanel({
  countryCode,
  countryId,
  canAct,
}: {
  countryCode: string;
  countryId: CountryId;
  /** False for a viewer who does not hold the seat — the panel reads as a record. */
  canAct: boolean;
}) {
  const [target, setTarget] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);
  const [truces, setTruces] = useState<Record<string, number>>({});

  // Stated up front rather than left to the refusal. A player picking a country they
  // signed peace with 30 turns ago should see the bar in the picker, not after
  // committing to a declaration.
  useEffect(() => {
    let live = true;
    void fetchJson<{ truces?: Array<{ other: string; expiresTurn: number }> }>(
      `/api/country/${countryCode}/executive/truces`,
      { feature: "declare-war-truces" }
    )
      .then((body) => {
        if (!live || !body?.truces) return;
        setTruces(Object.fromEntries(body.truces.map((t) => [t.other, t.expiresTurn])));
      })
      .catch((err: unknown) => {
        // Reported by fetchJson, then dropped on purpose: a failed lookup must not
        // block the form. The server still refuses a truced target, so the worst
        // case is the old discover-by-refusal path.
        if (process.env.NODE_ENV === "development") console.warn("truce lookup failed", err);
      });
    return () => {
      live = false;
    };
  }, [countryCode]);

  // Only player-enabled countries, read at runtime from /api/game/countries so an
  // admin switching a country on takes effect without a redeploy. COUNTRY_ORDER
  // would also have offered sub-national entities and countries not yet open.
  const enabled = useEnabledCountryIds();
  const targets = enabled.filter((c) => c !== countryId);
  const selectedGoal = WAR_GOALS.find((g) => g.id === goal);
  const trucedUntil = target ? truces[target] : undefined;
  const ready = !!target && !!goal && !busy && trucedUntil === undefined;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/executive/declare-war`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCountry: target, warGoal: goal }),
      });
      if (!res.ok) {
        // The route refuses for reasons invisible here — already at war, a
        // declaration already before the chambers, the seat lost since load.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "The declaration could not be filed.");
        return;
      }
      setFiled(true);
    } catch {
      setError("The declaration could not be filed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Declaration of war"
      sub="Filed by the executive, ratified by the legislature"
      right={!canAct ? <Badge tone="muted">Read-only</Badge> : undefined}
    >
      {filed ? (
        <p className="text-[12px] text-success" role="status">
          Declaration filed. It now goes before the legislature, which must pass it by a two-thirds
          supermajority before the war begins.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[12px] text-muted">
            Passing this does not begin a war on its own. It puts a declaration before the
            legislature, which must carry it by a{" "}
            <strong>two-thirds supermajority of votes cast</strong> in every chamber. Only the head
            of government and the defence minister may file one, and only once every{" "}
            {WAR_DECLARATION_COOLDOWN_TURNS} turns. You cannot open a second war against a country
            you are already fighting — including one facing you on the other side of a war someone
            else started. Filing costs {BILL_PROPOSE_ACTION_COST} action points, like any other
            bill, refunded if the legislature passes it.
          </p>

          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Target country"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!canAct}
              className="min-w-[160px] flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
            >
              <option value="">
                {targets.length === 0 ? "Loading countries…" : "Select a country…"}
              </option>
              {targets.map((c) => (
                <option key={c} value={c} disabled={truces[c] !== undefined}>
                  {COUNTRY_CONFIGS[c].name}
                  {truces[c] !== undefined ? ` — truce until turn ${truces[c]}` : ""}
                </option>
              ))}
            </select>

            <select
              aria-label="War goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={!canAct}
              className="min-w-[160px] flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px]"
            >
              <option value="">Select a war goal…</option>
              {WAR_GOALS.map((g) => (
                // Reserved goals stay visible but unselectable, so a player can see
                // what is coming. The server rejects them too — this is the cosmetic
                // half of that gate.
                <option key={g.id} value={g.id} disabled={!g.selectable}>
                  {g.label}
                  {g.selectable ? "" : " — not yet available"}
                </option>
              ))}
            </select>
          </div>

          {selectedGoal && <p className="mt-2 text-[11px] text-muted">{selectedGoal.blurb}</p>}

          {trucedUntil !== undefined && (
            <p className="mt-2 text-[11px] text-warning">
              A truce with that country holds until turn {trucedUntil}. You cannot declare war on
              them before then.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-2 text-[11px] text-error">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canAct || !ready}
            className="mt-3 w-full rounded-lg bg-[var(--gov)] py-2.5 text-[12px] font-bold text-[#1a1200] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Filing…" : "File declaration of war"}
          </button>
        </>
      )}
    </SectionCard>
  );
}
