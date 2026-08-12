"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

/**
 * B6 currency regimes, from the chair's seat.
 *
 * The regime is a declared commitment (float, band, or peg) plus a capital
 * account stance, and the impossible trinity prices the combination: a stable
 * rate with an open capital account costs the policy rate. The panel shows
 * the standing declaration and what it gives up, and lets the seated chair
 * change it. Country-scoped only: an intorg bank has no single chair-declared
 * regime, and the API path this posts to is country-scoped.
 *
 * Authorization mirrors the route exactly: only the seated chair may post.
 * Admins can see the state here but change it through the same seat everyone
 * else does.
 */

type FxRegime = "float" | "band" | "peg";

interface TrinityView {
  monetaryIndependence: boolean;
  exchangeRateStability: boolean;
  capitalMobility: boolean;
  wasteful: boolean;
}

interface FxRegimeView {
  regime: FxRegime;
  capitalControls: boolean;
  pegTarget: number | null;
  trinity: TrinityView;
  summary: string;
  changeableFromTurn: number;
}

const REGIME_LABELS: Record<FxRegime, string> = {
  float: "Float",
  band: "Band",
  peg: "Peg",
};

const REGIME_BLURBS: Record<FxRegime, string> = {
  float:
    "The rate goes where the market takes it. No reserves are committed to defending anything.",
  band: "A public promise to defend a corridor. Set the floor and ceiling in the intervention band controls on this tab; the trinity treats a band as a fixed rate.",
  peg: "A hard commitment to one rate. With an open capital account, defending it takes the policy rate out of your hands.",
};

export function CurrencyRegimePanel({
  bankApiBasePath,
  isChair,
  currentTurn,
  onChanged,
}: {
  bankApiBasePath: string;
  isChair: boolean;
  currentTurn: number;
  onChanged: () => void;
}) {
  const [data, setData] = useState<FxRegimeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [regime, setRegime] = useState<FxRegime>("float");
  const [capitalControls, setCapitalControls] = useState(false);
  const [pegTarget, setPegTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const countryScoped = bankApiBasePath.startsWith("/api/country/");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${bankApiBasePath}/fx-regime`);
      if (!res.ok) {
        setLoadError("Could not load the currency regime.");
        return;
      }
      const json: FxRegimeView = await res.json();
      setData(json);
      setRegime(json.regime);
      setCapitalControls(json.capitalControls);
      setPegTarget(json.pegTarget != null ? String(json.pegTarget) : "");
    } catch {
      setLoadError("Could not load the currency regime.");
    }
  }, [bankApiBasePath]);

  useEffect(() => {
    if (countryScoped) void load();
  }, [countryScoped, load]);

  if (!countryScoped) return null;

  const cooldownRemaining = data ? Math.max(0, data.changeableFromTurn - currentTurn) : 0;
  const desiredPegTarget = parseFloat(pegTarget);
  const pegValid = regime !== "peg" || (!isNaN(desiredPegTarget) && desiredPegTarget > 0);
  const dirty =
    data !== null &&
    (regime !== data.regime ||
      capitalControls !== data.capitalControls ||
      (regime === "peg" && desiredPegTarget !== data.pegTarget));

  async function submit() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${bankApiBasePath}/fx-regime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regime,
          capitalControls,
          ...(regime === "peg" ? { pegTarget: desiredPegTarget } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Request failed.");
      } else {
        setSuccess(`Regime declared. ${json.summary ?? ""}`.trim());
        setConfirming(false);
        await load();
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
      <h3 className="mb-2 text-lg font-semibold">Currency Regime</h3>

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {data && (
        <div className="mb-3 text-sm">
          <p>
            Declared regime: <span className="font-semibold">{REGIME_LABELS[data.regime]}</span>
            {data.regime === "peg" && data.pegTarget != null && (
              <>
                {" "}
                at <span className="font-mono">{data.pegTarget.toFixed(4)}</span> per internal unit
              </>
            )}{" "}
            with the capital account{" "}
            <span className="font-semibold">{data.capitalControls ? "closed" : "open"}</span>
          </p>
          <p className="mt-1 text-gray-400">{data.summary}</p>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3">
            <TrinityCorner label="Stable exchange rate" held={data.trinity.exchangeRateStability} />
            <TrinityCorner label="Free capital movement" held={data.trinity.capitalMobility} />
            <TrinityCorner
              label="Independent policy rate"
              held={data.trinity.monetaryIndependence}
            />
          </div>
          {data.trinity.wasteful && (
            <p className="mt-2 text-yellow-400">
              This configuration gives up more than the trinity requires.
            </p>
          )}
          {cooldownRemaining > 0 && (
            <p className="mt-2 text-yellow-400">
              Cooldown: {cooldownRemaining} turn{cooldownRemaining === 1 ? "" : "s"} before the
              regime can be changed again.
            </p>
          )}
        </div>
      )}

      {isChair && data && (
        <div className="space-y-3 border-t border-gray-800 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(REGIME_LABELS) as FxRegime[]).map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer flex-col rounded border px-3 py-2 text-sm ${
                  regime === r
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-700 hover:border-gray-500"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="radio"
                    name="fx-regime"
                    checked={regime === r}
                    onChange={() => setRegime(r)}
                    disabled={submitting}
                  />
                  {REGIME_LABELS[r]}
                </span>
                <span className="mt-1 text-xs text-gray-400">{REGIME_BLURBS[r]}</span>
              </label>
            ))}
          </div>

          {regime === "peg" && (
            <label className="flex max-w-xs flex-col text-sm">
              Peg target (rate per internal unit)
              <input
                type="number"
                step="0.0001"
                min={0}
                value={pegTarget}
                onChange={(e) => setPegTarget(e.target.value)}
                className="rounded border border-gray-600 bg-gray-800 px-2 py-1 font-mono"
                disabled={submitting}
              />
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={capitalControls}
              onChange={(e) => setCapitalControls(e.target.checked)}
              disabled={submitting}
            />
            Impose capital controls (close the capital account)
          </label>

          {regime === "float" && (
            <p className="text-xs text-gray-500">
              Declaring a float cancels any standing intervention band. They are contradictory
              promises and cannot stand together.
            </p>
          )}

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={submit} disabled={submitting || !pegValid}>
                {submitting
                  ? "Declaring..."
                  : `Confirm: declare a ${REGIME_LABELS[regime].toLowerCase()}${capitalControls ? " with capital controls" : ""}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setConfirming(true);
              }}
              disabled={!dirty || !pegValid || cooldownRemaining > 0}
            >
              Declare regime
            </Button>
          )}
          <p className="text-xs text-gray-500">
            A declaration is public and locked in for 48 turns. A regime nobody believes is not a
            regime.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {success && <p className="mt-2 text-sm text-green-400">{success}</p>}
    </section>
  );
}

function TrinityCorner({ label, held }: { label: string; held: boolean }) {
  return (
    <span className={`text-xs ${held ? "text-green-400" : "text-gray-500 line-through"}`}>
      {held ? "Held: " : "Given up: "}
      {label}
    </span>
  );
}
