"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { MonetaryCard } from "./monetaryUi";
import type { MonetaryView } from "../../useCabinetOffice";

export function DebtOperationPanel({
  countryCode,
  positionId,
  canAct,
  currentTurn,
  m,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  canAct: boolean;
  currentTurn: number;
  m: MonetaryView;
  onUpdate: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const atBaseline = m.investorConfidence != null && m.investorConfidence >= m.confidenceBaseline;
  const inCooldown = !m.debtOp.active && currentTurn < m.debtOp.cooldownUntilTurn;
  const disabled = !canAct || submitting || m.debtOp.active || inCooldown;

  async function launch() {
    if (disabled) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/debt-operation`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = (await res.json()) as { error?: string; expiresTurn?: number };
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Failed to launch" });
        return;
      }
      setFeedback({
        type: "success",
        message: `Operation launched — runs through turn ${json.expiresTurn}.`,
      });
      onUpdate();
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MonetaryCard
      title="Debt Management Operation"
      hint="Costs 1 ministerial action. Accelerates investor-confidence recovery, lowering the sovereign premium."
    >
      {m.debtOp.active ? (
        <p className="text-sm text-success">Active — concludes on turn {m.debtOp.expiresTurn}.</p>
      ) : inCooldown ? (
        <p className="text-sm text-muted">On cooldown until turn {m.debtOp.cooldownUntilTurn}.</p>
      ) : atBaseline ? (
        <p className="text-sm text-muted">
          Confidence is at baseline — the premium is already 0, so an operation would have no
          effect.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Launch to add accelerated confidence recovery each turn over the operation window.
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" disabled={disabled} isLoading={submitting} onClick={launch}>
          Launch Operation
        </Button>
        {feedback && (
          <span
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </MonetaryCard>
  );
}
