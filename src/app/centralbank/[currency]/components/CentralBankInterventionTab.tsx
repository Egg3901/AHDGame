"use client";

import { useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { Button } from "@/components/ui";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { ForexSpreadStrengthControl } from "@/components/forex/ForexSpreadStrengthControl";

interface InterventionRecord {
  turn: number;
  direction: "buy" | "sell";
  reservesSpent: number;
  fundingSource: "forexRevenue" | "reserveBalance" | "spreadFeeReserves" | "mixed";
  resultingRate: number;
}

const FUNDING_SOURCE_LABELS: Record<string, string> = {
  forexRevenue: "Forex revenue pool",
  reserveBalance: "Reserve balance",
  spreadFeeReserves: "Spread fees",
  mixed: "Mixed",
};

interface InterventionPolicyView {
  floor: number;
  ceiling: number;
  setByCharacterName: string;
  setAtTurn: number;
  lastAdjustedAtTurn: number;
  recentInterventions: InterventionRecord[];
}

export interface ForexSpreadView {
  strength: number;
  min: number;
  max: number;
  default: number;
  cooldownTurns: number;
  turnsRemaining: number;
  nextChangeTurn: number;
  canEdit: boolean;
}

export interface InterventionData {
  currencyCode: CurrencyCode | null;
  baseRate: number | null;
  currentRate: number | null;
  policy: InterventionPolicyView | null;
  forexRevenue: number | null;
  reserveBalance: number | null;
  forexSpread?: ForexSpreadView | null;
}

interface Props {
  countryId: CountryId;
  data: InterventionData;
  isChair: boolean;
  isAdmin: boolean;
  chairControlsLocked: boolean;
  currentTurn: number;
  onChanged: () => void;
}

const COOLDOWN_TURNS = 6;

export function CentralBankInterventionTab({
  countryId,
  data,
  isChair,
  isAdmin,
  chairControlsLocked,
  currentTurn,
  onChanged,
}: Props) {
  const [floor, setFloor] = useState<string>(data.policy ? String(data.policy.floor) : "");
  const [ceiling, setCeiling] = useState<string>(data.policy ? String(data.policy.ceiling) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canEdit = (isChair && !chairControlsLocked) || isAdmin;
  const currencySym = data.currencyCode ? (CURRENCY_SYMBOLS[data.currencyCode] ?? "") : "";
  const totalReserves = (data.forexRevenue ?? 0) + (data.reserveBalance ?? 0);
  const inBand =
    data.policy && data.currentRate != null
      ? data.currentRate >= data.policy.floor && data.currentRate <= data.policy.ceiling
      : null;

  const turnsSinceAdjusted = data.policy ? currentTurn - data.policy.lastAdjustedAtTurn : null;
  const cooldownRemaining =
    turnsSinceAdjusted !== null && turnsSinceAdjusted < COOLDOWN_TURNS
      ? COOLDOWN_TURNS - turnsSinceAdjusted
      : 0;

  const desiredFloor = parseFloat(floor);
  const desiredCeiling = parseFloat(ceiling);
  const bandValid =
    !isNaN(desiredFloor) &&
    !isNaN(desiredCeiling) &&
    desiredFloor > 0 &&
    desiredFloor < desiredCeiling;

  const isWiden =
    data.policy &&
    bandValid &&
    desiredFloor <= data.policy.floor &&
    desiredCeiling >= data.policy.ceiling &&
    (desiredFloor !== data.policy.floor || desiredCeiling !== data.policy.ceiling);

  const submitLabel = data.policy ? (isWiden ? "Widen band" : "Narrow / shift band") : "Set band";

  async function submit(method: "POST" | "PATCH") {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/country/${countryId}/central-bank/intervention`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor: desiredFloor, ceiling: desiredCeiling }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Request failed.");
      } else {
        setSuccess(json.action === "widen" ? "Band widened." : "Band updated.");
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel the active band? This is subject to the 6-turn cooldown.")) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/country/${countryId}/central-bank/intervention`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Cancel failed.");
      } else {
        setSuccess("Band cancelled.");
        setFloor("");
        setCeiling("");
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {data.forexSpread && (
        <ForexSpreadStrengthControl
          countryId={countryId}
          currencyCode={data.currencyCode}
          forexSpread={data.forexSpread}
          onChanged={onChanged}
        />
      )}
      <section className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
        <h3 className="mb-2 text-lg font-semibold">FX Intervention Band</h3>
        {data.currentRate != null && (
          <p className="mb-2 text-sm text-gray-300">
            Current rate:{" "}
            <span className="font-mono">
              {data.currentRate.toFixed(4)} {data.currencyCode} per internal unit
            </span>
          </p>
        )}
        {data.policy ? (
          <div className="mb-3 text-sm">
            <p>
              Active band:{" "}
              <span className="font-mono">
                [{data.policy.floor.toFixed(4)}, {data.policy.ceiling.toFixed(4)}]
              </span>
            </p>
            <p className="text-gray-400">
              Status:{" "}
              {inBand === null ? (
                "-"
              ) : inBand ? (
                <span className="text-green-400">In band</span>
              ) : (
                <span className="text-red-400">Defending (outside band)</span>
              )}
            </p>
            <p className="text-gray-400">
              Set by {data.policy.setByCharacterName} on turn {data.policy.setAtTurn}
              {data.policy.lastAdjustedAtTurn !== data.policy.setAtTurn &&
                ` • last adjusted turn ${data.policy.lastAdjustedAtTurn}`}
            </p>
            {cooldownRemaining > 0 && (
              <p className="text-yellow-400">
                Cooldown: {cooldownRemaining} turn{cooldownRemaining === 1 ? "" : "s"} remaining
                before narrow/cancel
              </p>
            )}
          </div>
        ) : (
          <p className="mb-3 text-sm text-gray-400">No active band.</p>
        )}

        {canEdit && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(data.policy ? "PATCH" : "POST");
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col text-sm">
                Floor
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 font-mono"
                  disabled={submitting}
                />
              </label>
              <label className="flex flex-col text-sm">
                Ceiling
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value)}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 font-mono"
                  disabled={submitting}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!bandValid || submitting}>
                {submitLabel}
              </Button>
              {data.policy && (
                <Button type="button" variant="secondary" onClick={cancel} disabled={submitting}>
                  Cancel band
                </Button>
              )}
            </div>
          </form>
        )}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        {success && <p className="mt-2 text-sm text-green-400">{success}</p>}
      </section>

      {(isChair || isAdmin) && data.forexRevenue != null && data.reserveBalance != null && (
        <section className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
          <h3 className="mb-2 text-lg font-semibold">FX Reserves (Chair view)</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-400">Forex revenue pool</dt>
            <dd className="text-right font-mono">
              {currencySym}
              {Math.round(data.forexRevenue).toLocaleString("en-US")}
            </dd>
            <dt className="text-gray-400">Reserve balance</dt>
            <dd className="text-right font-mono">
              {currencySym}
              {Math.round(data.reserveBalance).toLocaleString("en-US")}
            </dd>
            <dt className="text-gray-400 font-semibold">Total available</dt>
            <dd className="text-right font-mono font-semibold">
              {currencySym}
              {Math.round(totalReserves).toLocaleString("en-US")}
            </dd>
          </dl>
          <p className="mt-2 text-xs text-gray-500">
            Intervention spends the forex revenue pool first, then the reserve balance. The reserve
            balance also backs the line of credit limit, so spending it on currency leaves less for
            lending.
          </p>
        </section>
      )}

      {data.policy && (isChair || isAdmin) && data.policy.recentInterventions.length > 0 && (
        <section className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
          <h3 className="mb-2 text-lg font-semibold">Recent interventions</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400">
              <tr>
                <th className="px-2 py-1">Turn</th>
                <th className="px-2 py-1">Direction</th>
                <th className="px-2 py-1">Reserves spent</th>
                <th className="px-2 py-1">Source</th>
                <th className="px-2 py-1">Resulting rate</th>
              </tr>
            </thead>
            <tbody>
              {[...data.policy.recentInterventions].reverse().map((r) => (
                <tr key={r.turn} className="border-t border-gray-800">
                  <td className="px-2 py-1 font-mono">{r.turn}</td>
                  <td className="px-2 py-1">{r.direction}</td>
                  <td className="px-2 py-1 font-mono">
                    {currencySym}
                    {Math.round(r.reservesSpent).toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1 text-gray-400">
                    {FUNDING_SOURCE_LABELS[r.fundingSource] ?? r.fundingSource}
                  </td>
                  <td className="px-2 py-1 font-mono">{r.resultingRate.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
