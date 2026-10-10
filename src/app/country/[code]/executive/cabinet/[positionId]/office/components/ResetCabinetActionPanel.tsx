"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CabinetOfficeData } from "../useCabinetOffice";
import { useTranslations } from "next-intl";

export function ResetCabinetActionPanel({
  model,
  canAct,
  countryCode,
  positionId,
  currencySymbol,
  onUpdate,
}: {
  model: NonNullable<CabinetOfficeData["resetCabinetActions"]>;
  canAct: boolean;
  countryCode: string;
  positionId: string;
  currencySymbol: string;
  onUpdate: () => void;
}) {
  const { showToast } = useToast();
  const translate = useTranslations("worldOrganizations.cabinetActions");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const activeIds = new Set(model.active.map((entry) => entry.actionId));
  const issue = async (actionId: string) => {
    setSubmitting(actionId);
    try {
      const response = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/reset-action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId }),
        }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Cabinet action failed");
      showToast("Cabinet action is now active", "success");
      onUpdate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Cabinet action failed", "error");
    } finally {
      setSubmitting(null);
    }
  };
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Cabinet actions">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Cabinet actions</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Temporary administrative efforts. They use the member&apos;s shared charge pool and,
            where shown, flexible department cash. They do not replace legislation or create
            Treasury funds.
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-foreground">{model.charges} of 4 charges</p>
          <p className="text-xs text-muted">
            {model.nextRechargeTurn === null
              ? "Charge pool full"
              : `Next charge on turn ${model.nextRechargeTurn}`}
          </p>
        </div>
      </div>
      {model.active.length > 0 && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
          <p className="font-semibold text-foreground">Active in this office</p>
          {model.active.map((entry) => (
            <p key={`${entry.actionId}:${entry.startsTurn}`} className="mt-1 text-muted">
              {model.actions.find((action) => action.id === entry.actionId)?.title ??
                entry.actionId}
              {` through turn ${entry.expiresTurn - 1}`}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {model.actions.map((action) => {
          const active = activeIds.has(action.id);
          return (
            <article
              key={action.id}
              className="rounded-lg border border-border bg-background p-4"
              title={action.description}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-foreground">{action.title}</h3>
                <span className="rounded bg-muted/20 px-2 py-1 text-xs text-muted">
                  {action.costClass}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">{action.brief}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <div>
                  <dt>Targets</dt>
                  <dd className="font-medium text-foreground">{action.targetNames.join(", ")}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd className="font-medium text-foreground">{action.scope}</dd>
                </div>
                <div>
                  <dt>Temporary strength</dt>
                  <dd className="font-medium text-success">+{action.strength.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Operating debit</dt>
                  <dd className="font-medium text-foreground">
                    {currencySymbol}
                    {Math.round(action.operatingCost).toLocaleString()}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={
                  !canAct ||
                  action.allowed === false ||
                  active ||
                  model.charges < 1 ||
                  submitting !== null
                }
                onClick={() => void issue(action.id)}
                className="mt-4 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {active ? "Active" : submitting === action.id ? "Issuing..." : "Use action"}
              </button>
              {action.blockReason && (
                <p className="mt-2 text-xs text-muted">
                  {translate(`blocked.${action.blockReason}`)}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
