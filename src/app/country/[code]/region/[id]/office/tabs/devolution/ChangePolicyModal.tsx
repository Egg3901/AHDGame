"use client";

import { useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  getDevolutionPolicyLabel,
} from "@/lib/constants/devolution";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";

interface Props {
  open: boolean;
  countryId: CountryId;
  stateId: string;
  currentPolicy: DevolutionPolicy;
  gubernatorialActions: number;
  /** When true the modal renders in admin-override mode: AP/cooldown waived,
   *  red theme, title flagged, and the POST body carries `adminOverride: true`.
   *  Caller is responsible for only enabling this when the viewer is admin. */
  adminOverride?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const POLICIES: DevolutionPolicy[] = ["anti", "pro", "independence"];

export function ChangePolicyModal({
  open,
  countryId,
  stateId,
  currentPolicy,
  gubernatorialActions,
  adminOverride = false,
  onClose,
  onSuccess,
}: Props) {
  const [selected, setSelected] = useState<DevolutionPolicy | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const apShort = !adminOverride && gubernatorialActions < DEVOLUTION_POLICY_CHANGE_AP_COST;
  const noChange = selected === currentPolicy;
  const canSubmit = selected != null && !apShort && !noChange && !submitting;

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/devolution-policy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            policy: selected,
            ...(adminOverride ? { adminOverride: true } : {}),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to change policy.");
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-card-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          Change Devolution Policy{adminOverride ? " (Admin)" : ""}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {adminOverride
            ? "Admin override — bypasses the AP cost and cooldown."
            : `Costs ${DEVOLUTION_POLICY_CHANGE_AP_COST} Office AP. Locked for the cooldown after changing.`}
        </p>

        <div className="mt-4 space-y-2">
          {POLICIES.map((p) => {
            const isCurrent = p === currentPolicy;
            const isPicked = p === selected;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setSelected(p)}
                disabled={isCurrent}
                className={`flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  isPicked
                    ? "border-primary bg-primary/10"
                    : isCurrent
                      ? "border-card-border bg-background/30 opacity-60"
                      : "border-card-border bg-background/50 hover:border-primary/60"
                }`}
              >
                <span className="font-medium">{getDevolutionPolicyLabel(stateId, p)}</span>
                {isCurrent && (
                  <span className="text-[10px] uppercase tracking-wider text-muted">Current</span>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div className="text-xs text-muted">
            {adminOverride ? (
              <span>Admin mode</span>
            ) : (
              <>
                Office AP: {gubernatorialActions}
                {apShort && (
                  <span className="text-rose-500"> (need {DEVOLUTION_POLICY_CHANGE_AP_COST})</span>
                )}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-card-border px-4 py-2 text-sm transition-colors hover:bg-card-border/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                adminOverride ? "bg-error hover:bg-error/80" : "bg-primary hover:bg-primary/90"
              }`}
            >
              {submitting ? "Confirming…" : "Confirm change"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
