"use client";

import { useState } from "react";
import { EXTRACTABLE_RESOURCES, COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { Modal } from "@/components/ui";

interface Props {
  legislatureId: string;
  legislatureLevel: "state" | "national";
  stateId?: string;
  /** Country that owns the contract — required for cross-country state-ID disambiguation. */
  countryId: string;
  onClose: () => void;
  onGranted: () => void;
}

export function GrantContractModal({
  legislatureId,
  legislatureLevel,
  stateId,
  countryId,
  onClose,
  onGranted,
}: Props) {
  const [formState, setFormState] = useState({
    stateId: stateId ?? "",
    corporationId: "",
    resource: "oil" as ExtractableResource,
    share: 0.1,
    submitting: false,
    error: "",
    awaitingConfirmation: false,
  });

  async function submit(force: boolean) {
    setFormState((s) => ({ ...s, submitting: true, error: "" }));

    const res = await fetch("/api/contracts/extraction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stateId: formState.stateId,
        countryId,
        corporationId: formState.corporationId,
        resource: formState.resource,
        share: formState.share,
        grantedBy: legislatureId,
        grantedByLevel: legislatureLevel,
        force,
      }),
    });

    const json = await res.json();

    // 409 means over-allocated — server did NOT insert, ask for confirmation
    if (res.status === 409 && json.needsConfirmation) {
      setFormState((s) => ({ ...s, submitting: false, awaitingConfirmation: true }));
      return;
    }

    if (!res.ok) {
      setFormState((s) => ({
        ...s,
        submitting: false,
        error: json.error ?? "Failed to grant contract",
      }));
      return;
    }

    onGranted();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  return (
    <Modal open title="Grant Resource Contract" onClose={onClose}>
      {formState.awaitingConfirmation && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Warning: this contract over-allocates the state&apos;s capacity for this resource.
          Open-access extraction will be reduced to zero. Grant anyway?
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => submit(true)}
              disabled={formState.submitting}
              className="rounded bg-warning px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
            >
              {formState.submitting ? "Granting..." : "Grant anyway"}
            </button>
            <button onClick={onClose} className="text-xs text-muted hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!formState.awaitingConfirmation && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!stateId && (
            <div>
              <label className="mb-1 block text-sm font-medium">State</label>
              <input
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                placeholder="e.g. TX"
                value={formState.stateId}
                onChange={(e) =>
                  setFormState((s) => ({ ...s, stateId: e.target.value.toUpperCase() }))
                }
                required
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Corporation ID</label>
            <input
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 font-mono text-sm"
              placeholder="24-character ObjectId"
              value={formState.corporationId}
              onChange={(e) => setFormState((s) => ({ ...s, corporationId: e.target.value }))}
              required
              pattern="[0-9a-f]{24}"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Resource</label>
            <select
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              value={formState.resource}
              onChange={(e) =>
                setFormState((s) => ({ ...s, resource: e.target.value as ExtractableResource }))
              }
            >
              {EXTRACTABLE_RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {COMMODITY_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Share: {(formState.share * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={Math.round(formState.share * 100)}
              onChange={(e) => setFormState((s) => ({ ...s, share: Number(e.target.value) / 100 }))}
              className="w-full"
            />
          </div>

          {formState.error && <p className="text-sm text-error">{formState.error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={formState.submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {formState.submitting ? "Granting..." : "Grant Contract"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
