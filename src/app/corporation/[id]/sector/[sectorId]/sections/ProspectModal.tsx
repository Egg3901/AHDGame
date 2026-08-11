"use client";

import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import {
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  PROSPECT_DURATION_TURNS,
  PROSPECT_BASE_COST_ANCHOR,
  PROSPECT_MAX_GAIN_FRACTION,
  prospectCorpSuccessChance,
  prospectCorpRdMult,
  PROSPECT_YIELD_MIN,
  PROSPECT_YIELD_MAX,
} from "@/lib/constants/prospecting";

interface ProspectModalProps {
  corpId: string;
  stateId: string;
  resource: ExtractableResource;
  capacity: number;
  rdScore: number;
  liquidCurrencyCode?: string | null;
  onClose: () => void;
  onLaunched: () => void;
}

/**
 * Launch a corporation-funded geological survey for one (state, resource).
 * POST /api/prospecting/corporation {corporationId, stateId, resource}.
 * Success odds and yield range are derived from the corp's current rdScore —
 * see prospectCorpSuccessChance / prospectCorpRdMult.
 */
export default function ProspectModal({
  corpId,
  stateId,
  resource,
  capacity,
  rdScore,
  liquidCurrencyCode,
  onClose,
  onLaunched,
}: ProspectModalProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const successChance = prospectCorpSuccessChance(rdScore);
  const rdMult = prospectCorpRdMult(rdScore);
  const yieldMinUnits = Math.round(capacity * PROSPECT_YIELD_MIN * rdMult);
  const yieldMaxUnits = Math.min(
    Math.round(capacity * PROSPECT_YIELD_MAX * rdMult),
    Math.round(capacity * PROSPECT_MAX_GAIN_FRACTION)
  );
  const unit = COMMODITY_UNITS[resource] ?? "";

  const startingCostAnchor = PROSPECT_BASE_COST_ANCHOR;
  const currencyCode = (liquidCurrencyCode as CurrencyCode | null | undefined) ?? undefined;
  const startingCostDisplay = currencyCode
    ? formatAmount(startingCostAnchor, currencyCode)
    : formatAmount(startingCostAnchor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/prospecting/corporation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corporationId: corpId, stateId, resource }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to launch the survey.");
        setSubmitting(false);
        return;
      }
      showToast(
        `Survey launched for ${COMMODITY_LABELS[resource] ?? resource}. Results in ${PROSPECT_DURATION_TURNS} turns.`,
        "success"
      );
      onLaunched();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={`Prospect for ${COMMODITY_LABELS[resource] ?? resource}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          Send a survey crew to search for new{" "}
          {(COMMODITY_LABELS[resource] ?? resource).toLowerCase()} deposits in this state. Takes{" "}
          {PROSPECT_DURATION_TURNS} turns to complete.
        </p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Success odds
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {Math.round(successChance * 100)}%
            </div>
            <p className="mt-0.5 text-xs text-muted">Higher with more R&amp;D score.</p>
          </div>
          <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Expected yield
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {yieldMinUnits.toLocaleString("en-US")}-{yieldMaxUnits.toLocaleString("en-US")}
            </div>
            <p className="mt-0.5 text-xs text-muted">{unit} added to state capacity on success.</p>
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Starting cost</span>
            <span className="font-medium tabular-nums text-foreground">{startingCostDisplay}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Cost escalates the more this state has already been successfully surveyed for this
            resource (up to 4x). The exact cost is charged on launch.
          </p>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Launching..." : "Launch Survey"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
