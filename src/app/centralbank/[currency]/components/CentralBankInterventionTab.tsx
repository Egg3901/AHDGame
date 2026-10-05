"use client";

import { InlineError } from "@/components/ui/InlineError";
import { apiErrorText } from "@/lib/errors/catalog";
import { useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { Button } from "@/components/ui";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { ForexSpreadStrengthControl } from "@/components/forex/ForexSpreadStrengthControl";
import { CB_TH, CentralBankSection } from "./CentralBankSection";

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
        setError(apiErrorText(json, "Request failed."));
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
        setError(apiErrorText(json, "Cancel failed."));
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
    <div className="space-y-12">
      {data.forexSpread && (
        <ForexSpreadStrengthControl
          countryId={countryId}
          currencyCode={data.currencyCode}
          forexSpread={data.forexSpread}
          onChanged={onChanged}
        />
      )}
      <CentralBankSection title="FX intervention band">
        {data.currentRate != null && (
          <p className="mb-2 text-body text-muted">
            Current rate:{" "}
            <span className="font-mono text-foreground">
              {data.currentRate.toFixed(4)} {data.currencyCode} per internal unit
            </span>
          </p>
        )}
        {data.policy ? (
          <div className="mb-4 space-y-0.5 text-body">
            <p>
              Active band:{" "}
              <span className="font-mono">
                [{data.policy.floor.toFixed(4)}, {data.policy.ceiling.toFixed(4)}]
              </span>
            </p>
            <p className="text-muted">
              Status:{" "}
              {inBand === null ? (
                "-"
              ) : inBand ? (
                <span className="text-foreground">In band</span>
              ) : (
                <span className="font-medium text-error">Defending (outside band)</span>
              )}
            </p>
            <p className="text-muted">
              Set by {data.policy.setByCharacterName} on turn {data.policy.setAtTurn}
              {data.policy.lastAdjustedAtTurn !== data.policy.setAtTurn &&
                ` · last adjusted turn ${data.policy.lastAdjustedAtTurn}`}
            </p>
            {cooldownRemaining > 0 && (
              <p className="text-warning">
                Cooldown: {cooldownRemaining} turn{cooldownRemaining === 1 ? "" : "s"} remaining
                before narrow/cancel
              </p>
            )}
          </div>
        ) : (
          <p className="mb-4 text-body text-muted">No active band.</p>
        )}

        {canEdit && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(data.policy ? "PATCH" : "POST");
            }}
          >
            <div className="grid max-w-md grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-body-sm text-muted">
                Floor
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  className="rounded-md border border-card-border bg-background px-2 py-1 font-mono text-body text-foreground"
                  disabled={submitting}
                />
              </label>
              <label className="flex flex-col gap-1 text-body-sm text-muted">
                Ceiling
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value)}
                  className="rounded-md border border-card-border bg-background px-2 py-1 font-mono text-body text-foreground"
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

        <InlineError error={error} className="mt-2 text-body text-error" />
        {success && <p className="mt-2 text-body text-success">{success}</p>}
      </CentralBankSection>

      {(isChair || isAdmin) && data.forexRevenue != null && data.reserveBalance != null && (
        <CentralBankSection title="FX reserves" meta="Chair view">
          <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-body">
            <dt className="text-muted">Forex revenue pool</dt>
            <dd className="text-right font-mono">
              {currencySym}
              {Math.round(data.forexRevenue).toLocaleString("en-US")}
            </dd>
            <dt className="text-muted">Reserve balance</dt>
            <dd className="text-right font-mono">
              {currencySym}
              {Math.round(data.reserveBalance).toLocaleString("en-US")}
            </dd>
            <dt className="font-semibold text-foreground">Total available</dt>
            <dd className="text-right font-mono font-semibold">
              {currencySym}
              {Math.round(totalReserves).toLocaleString("en-US")}
            </dd>
          </dl>
          <p className="mt-3 max-w-3xl text-body-sm text-muted">
            Intervention spends the forex revenue pool first, then the reserve balance. The reserve
            balance also backs the line of credit limit, so spending it on currency leaves less for
            lending.
          </p>
        </CentralBankSection>
      )}

      {data.policy && (isChair || isAdmin) && data.policy.recentInterventions.length > 0 && (
        <CentralBankSection title="Recent interventions">
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr>
                  <th scope="col" className={CB_TH}>
                    Turn
                  </th>
                  <th scope="col" className={CB_TH}>
                    Direction
                  </th>
                  <th scope="col" className={CB_TH}>
                    Reserves spent
                  </th>
                  <th scope="col" className={CB_TH}>
                    Source
                  </th>
                  <th scope="col" className={CB_TH}>
                    Resulting rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.policy.recentInterventions].reverse().map((r) => (
                  <tr key={r.turn} className="border-b border-card-border/60">
                    <td className="py-2 pr-4 font-mono tabular-nums">{r.turn}</td>
                    <td className="py-2 pr-4">{r.direction}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums">
                      {currencySym}
                      {Math.round(r.reservesSpent).toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {FUNDING_SOURCE_LABELS[r.fundingSource] ?? r.fundingSource}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums">
                      {r.resultingRate.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CentralBankSection>
      )}
    </div>
  );
}
