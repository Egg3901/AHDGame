"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState } from "react";

/**
 * Admin switch for `gameConfig.sandboxTesterAccessEnabled`. While on, accounts
 * granted sandbox access (Users tab, row menu) see the sandbox link without
 * being supporters. Off restores staff-and-supporters only.
 */
export function SandboxAccessSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sandbox-access");
      if (res.ok) setEnabled((await res.json()).enabled === true);
    } catch {
      // Switch stays hidden if the status cannot be read.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (enabled === null) return null;

  const toggle = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sandbox-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) return setError(apiErrorText(data, "Failed to update sandbox access"));
      setEnabled(data.enabled === true);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold">Sandbox tester access</h3>
        <p className="text-xs text-muted">
          When on, accounts granted sandbox access (row menu: Grant sandbox) can open the sandbox
          without being supporters. No supporter perks are granted.
        </p>
        {error && <p className="mt-1 text-xs text-error">{error}</p>}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{ background: enabled ? "var(--muted)" : "var(--success)" }}
      >
        {saving ? "Updating..." : enabled ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
