"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface ExtractionFlags {
  prospectingEnabled: boolean;
  contractIssuanceEnabled: boolean;
}

interface ExtractionConfigResponse extends Partial<ExtractionFlags> {
  prospectingEnabledUpdatedBy?: string | null;
  prospectingEnabledUpdatedAt?: string | null;
  contractIssuanceEnabledUpdatedBy?: string | null;
  contractIssuanceEnabledUpdatedAt?: string | null;
}

const FEATURE_TOGGLES: Array<{
  key: keyof ExtractionFlags;
  label: string;
  description: string;
}> = [
  {
    key: "prospectingEnabled",
    label: "Resource prospecting",
    description:
      "Corporations and governments can pay for geological surveys that expand a state's extraction capacity (12-turn resolution).",
  },
  {
    key: "contractIssuanceEnabled",
    label: "Contract issuance",
    description:
      "Governments can offer extraction contracts to corporations (signing fee + per-turn royalty + term), and per-turn royalty settlement runs.",
  },
];

/**
 * Admin toggles for the two resource-prospecting / extraction-contract
 * gameConfig flags. GET /api/admin/config/extraction seeds the current flag
 * state (plus who last changed each flag and when); PATCH toggles one flag
 * at a time. Modeled on MarketAdminPanel's feature-toggle rows.
 */
export function ExtractionAdminPanel() {
  const [flags, setFlags] = useState<ExtractionFlags | null>(null);
  const [audit, setAudit] = useState<
    Partial<Record<keyof ExtractionFlags, { by: string; at: string }>>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config/extraction");
      if (res.ok) {
        const data = (await res.json()) as ExtractionConfigResponse;
        setFlags({
          prospectingEnabled: data.prospectingEnabled === true,
          contractIssuanceEnabled: data.contractIssuanceEnabled === true,
        });
        const nextAudit: Partial<Record<keyof ExtractionFlags, { by: string; at: string }>> = {};
        if (data.prospectingEnabledUpdatedBy && data.prospectingEnabledUpdatedAt) {
          nextAudit.prospectingEnabled = {
            by: data.prospectingEnabledUpdatedBy,
            at: data.prospectingEnabledUpdatedAt,
          };
        }
        if (data.contractIssuanceEnabledUpdatedBy && data.contractIssuanceEnabledUpdatedAt) {
          nextAudit.contractIssuanceEnabled = {
            by: data.contractIssuanceEnabledUpdatedBy,
            at: data.contractIssuanceEnabledUpdatedAt,
          };
        }
        setAudit(nextAudit);
        setError("");
      } else {
        setError(`Couldn't load the current extraction settings (HTTP ${res.status}).`);
      }
    } catch {
      setError("Couldn't load the current extraction settings (network error).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  async function handleToggleFlag(key: keyof ExtractionFlags) {
    if (!flags) return;
    const next = !flags[key];
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/config/extraction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to update settings");
        return;
      }
      await fetchStatus();
      const toggle = FEATURE_TOGGLES.find((f) => f.key === key);
      setMessage(`${toggle?.label ?? key} ${next ? "enabled" : "disabled"}.`);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading extraction settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <h3 className="text-sm font-semibold">Resource prospecting & extraction contracts</h3>
      <p className="mt-1 mb-4 text-xs text-muted">
        Ships flag-off. Both flags default to off for existing saves and can be enabled
        independently, though contract issuance without prospecting still works (governments can
        still contract out existing capacity).
      </p>

      {error ? (
        <p className="mb-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-3 text-xs text-success" role="status">
          {message}
        </p>
      ) : null}

      <div className="space-y-3">
        {FEATURE_TOGGLES.map((toggle) => {
          const enabled = flags?.[toggle.key] === true;
          const lastChange = audit[toggle.key];
          return (
            <div
              key={toggle.key}
              className="flex items-start justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{toggle.label}</div>
                <p className="mt-0.5 text-xs text-muted">{toggle.description}</p>
                {lastChange && (
                  <p className="mt-1 text-[11px] text-muted/70">
                    Last changed by {lastChange.by} (<LocalTime value={lastChange.at} />)
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={saving || flags === null}
                onClick={() => void handleToggleFlag(toggle.key)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                  enabled ? "bg-primary" : "bg-card-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    enabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
