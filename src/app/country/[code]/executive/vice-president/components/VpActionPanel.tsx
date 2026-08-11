"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { VpActionDef } from "@/lib/constants/vicePresidentActions";

interface VpActionPanelProps {
  actions: VpActionDef[];
  actionsRemaining: number;
  resetHint: string;
  canAct: boolean;
  /** True when there is a character-backed president to campaign for. */
  hasPresident: boolean;
  countryCode: string;
  onUpdate: () => void;
}

/**
 * Vice-president self-serve actions (#67). Mirrors the cabinet
 * MinisterialOrderPanel: a per-turn action counter, one card per action, and
 * inline success/error feedback. Each action costs one VP action.
 */
export function VpActionPanel({
  actions,
  actionsRemaining,
  resetHint,
  canAct,
  hasPresident,
  countryCode,
  onUpdate,
}: VpActionPanelProps) {
  const [acting, setActing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    actionId: string;
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canSpend = canAct && actionsRemaining > 0;

  async function handleAct(actionId: string) {
    if (!canSpend || acting) return;
    setActing(actionId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/country/${countryCode}/executive/vice-president/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId }),
      });
      const json = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setFeedback({ actionId, type: "error", message: json.error ?? "Failed to take action" });
        return;
      }
      setFeedback({ actionId, type: "success", message: json.message ?? "Action taken." });
      onUpdate();
    } catch {
      setFeedback({ actionId, type: "error", message: "Network error" });
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Vice-Presidential Actions</h2>
          <p className="mt-0.5 text-sm text-muted">
            Use the office to steady the administration and build your own standing.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`text-sm font-semibold ${actionsRemaining > 0 ? "text-foreground" : "text-muted"}`}
          >
            {actionsRemaining} {actionsRemaining !== 1 ? "actions" : "action"} remaining
          </span>
          {actionsRemaining < 2 && <p className="mt-1 text-xs text-muted">{resetHint}</p>}
        </div>
      </div>

      {!canAct && (
        <p className="mb-4 rounded-lg border border-card-border bg-card-muted p-3 text-sm text-muted">
          Only the sitting vice-president can take these actions.
        </p>
      )}

      <div className="space-y-3">
        {actions.map((action) => {
          const isActingThis = acting === action.id;
          const actionFeedback = feedback?.actionId === action.id ? feedback : null;
          const needsPresident = action.id === "surrogate_address" && !hasPresident;
          const disabled = !canSpend || isActingThis || needsPresident;

          return (
            <div
              key={action.id}
              className="rounded-lg border border-card-border bg-card-elevated p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{action.name}</h3>
                  <p className="mt-1 text-xs leading-snug text-muted">{action.description}</p>
                  {needsPresident && (
                    <p className="mt-1 text-xs text-warning">
                      No sitting president to campaign for.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    isLoading={isActingThis}
                    onClick={() => handleAct(action.id)}
                  >
                    Take Action
                  </Button>
                </div>
              </div>
              {actionFeedback && (
                <p
                  className={`mt-2 text-xs ${actionFeedback.type === "success" ? "text-success" : "text-error"}`}
                >
                  {actionFeedback.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
