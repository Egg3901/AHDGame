"use client";

import { useMemo, useState } from "react";
import { partyApiUrl } from "@/lib/urls";
import { getMessageStyle } from "@/lib/utils/formatters";
import {
  MAX_TAX_RATE,
  MAX_GOTV_PERCENT,
  MAX_ORG_BUILDING_PERCENT,
} from "@/lib/api/schemas/settings";

/**
 * Chair-Office card: bulk-apply one state-party org setting to the same value
 * across every state chapter at once, instead of editing each state separately.
 * Suggestion #13 ("Improve ease of management of state party politics").
 *
 * Only settings that are a single persisted scalar are offered here; the same
 * bounds the per-state routes enforce are reused via the shared MAX_* constants,
 * and the server re-validates and re-authorizes (national chair only).
 */

interface BulkStateOrgControlProps {
  countryCode: string;
  partyId: string;
  onApplied?: () => void;
}

type SettingKey = "tax" | "orgBuilding" | "suppression";

interface SettingOption {
  key: SettingKey;
  label: string;
  max: number;
  help: string;
}

const SETTING_OPTIONS: SettingOption[] = [
  {
    key: "tax",
    label: "State tax rate",
    max: MAX_TAX_RATE,
    help: "% taken from member fund generation",
  },
  {
    key: "orgBuilding",
    label: "Org building budget",
    max: MAX_ORG_BUILDING_PERCENT,
    help: "% of state party revenue spent building organization",
  },
  {
    key: "suppression",
    label: "Suppression budget",
    max: MAX_GOTV_PERCENT,
    help: "% of state party revenue spent on voter suppression",
  },
];

export function BulkStateOrgControl({ countryCode, partyId, onApplied }: BulkStateOrgControlProps) {
  const [settingKey, setSettingKey] = useState<SettingKey>("tax");
  const [value, setValue] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  const option = useMemo(
    () => SETTING_OPTIONS.find((o) => o.key === settingKey) ?? SETTING_OPTIONS[0],
    [settingKey]
  );

  const numericValue = Number(value);
  const valueValid =
    Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= option.max;

  const handleApply = async () => {
    if (!valueValid || submitting) return;
    setSubmitting(true);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(countryCode, partyId)}/bulk-org`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting: settingKey, value: Math.round(numericValue) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg(`✗ ${body.error ?? "Failed to apply setting"}`);
        return;
      }
      setMsg(`✓ ${body.message ?? "Applied to all state chapters"}`);
      onApplied?.();
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Bulk State Settings</h2>
        <span className="text-xs text-muted">Applies to every state chapter</span>
      </div>

      <p className="text-xs text-muted mb-4">
        Set one state-party org setting to the same value across all of this party&apos;s state
        chapters at once, instead of editing each state individually. State chairs can still
        override any state afterward.
      </p>

      {msg && <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Setting
          <select
            value={settingKey}
            onChange={(e) => {
              setSettingKey(e.target.value as SettingKey);
              setMsg("");
            }}
            className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-normal normal-case text-foreground"
          >
            {SETTING_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wider text-muted">
          Value (%)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={option.max}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-normal sm:w-28"
          />
        </label>

        <button
          onClick={handleApply}
          disabled={submitting || !valueValid}
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {submitting ? "Applying…" : "Apply to all states"}
        </button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {option.help}. Allowed range 0–{option.max}%.
      </p>
    </div>
  );
}
