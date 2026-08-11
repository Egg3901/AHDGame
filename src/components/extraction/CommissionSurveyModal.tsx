"use client";

import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import {
  EXTRACTABLE_RESOURCES,
  COMMODITY_LABELS,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import {
  PROSPECT_DURATION_TURNS,
  PROSPECT_BASE_COST_ANCHOR,
  PROSPECT_GOVT_SUCCESS_CHANCE,
  PROSPECT_YIELD_MIN,
  PROSPECT_YIELD_MAX,
  PROSPECT_GOVT_RD_MULT,
} from "@/lib/constants/prospecting";

interface StateOption {
  id: string;
  name: string;
}

interface CommissionSurveyModalProps {
  level: "national" | "state";
  countryId: string;
  /** Fixed for a state-level survey. Omit for national to show a state picker. */
  stateId?: string;
  /** Required when stateId is omitted (national level, no state pre-selected). */
  stateOptions?: StateOption[];
  onClose: () => void;
  onLaunched: () => void;
}

/**
 * Government geological survey launch modal — POST /api/prospecting/government
 * {countryId, stateId, resource, level}. Shared by the state resources tab
 * (governor, level:"state") and the national executive surface (level:"national").
 * Government surveys use a flat 50% success chance and a 1.5x yield multiplier
 * (no rdScore input), unlike corporation surveys.
 */
export function CommissionSurveyModal({
  level,
  countryId,
  stateId: fixedStateId,
  stateOptions,
  onClose,
  onLaunched,
}: CommissionSurveyModalProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const [stateId, setStateId] = useState(fixedStateId ?? stateOptions?.[0]?.id ?? "");
  const [resource, setResource] = useState<ExtractableResource>("oil");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const yieldMinPct = Math.round(PROSPECT_YIELD_MIN * PROSPECT_GOVT_RD_MULT * 100 * 10) / 10;
  const yieldMaxPct = Math.round(PROSPECT_YIELD_MAX * PROSPECT_GOVT_RD_MULT * 100 * 10) / 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stateId) {
      setError("Choose a state.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/prospecting/government", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId, stateId, resource, level }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to commission the survey.");
        setSubmitting(false);
        return;
      }
      showToast(
        `Geological survey commissioned for ${COMMODITY_LABELS[resource] ?? resource}. Results in ${PROSPECT_DURATION_TURNS} turns.`,
        "success"
      );
      onLaunched();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open title="Commission Geological Survey" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          Fund a state survey crew to search for new extraction capacity. Takes{" "}
          {PROSPECT_DURATION_TURNS} turns and succeeds{" "}
          {Math.round(PROSPECT_GOVT_SUCCESS_CHANCE * 100)}% of the time. On success, capacity grows
          by {yieldMinPct}-{yieldMaxPct}% of the state&apos;s current capacity for that resource.
        </p>

        {!fixedStateId && stateOptions && (
          <div>
            <label className="mb-1 block text-sm font-medium">State</label>
            <select
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              required
            >
              {stateOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Resource</label>
          <select
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            value={resource}
            onChange={(e) => setResource(e.target.value as ExtractableResource)}
          >
            {EXTRACTABLE_RESOURCES.map((r) => (
              <option key={r} value={r}>
                {COMMODITY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Starting cost</span>
            <span className="font-medium tabular-nums text-foreground">
              {formatAmount(PROSPECT_BASE_COST_ANCHOR)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Cost escalates the more this state has already been successfully surveyed for this
            resource (up to 4x). The exact cost is confirmed on launch.
          </p>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Commissioning..." : "Commission Survey"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
