"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { regionRedistrictUrl } from "@/lib/urls";

/**
 * Admin-only control on the State Politics tab to reset a state's district map
 * and open the redistrict editor. US-only; hidden when the feature flag is off.
 */
export function AdminRedistrictPanel({
  countryCode,
  stateId,
}: {
  countryCode: string;
  stateId: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = (await res.json()) as { user?: { redistrictingEnabled?: boolean } };
        setEnabled(data.user?.redistrictingEnabled ?? false);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleTrigger() {
    if (triggering) return;
    setTriggering(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/country/${countryCode.toLowerCase()}/region/${encodeURIComponent(stateId)}/redistrict/trigger`,
        { method: "POST" }
      );
      const data = (await res.json()) as { error?: string; redirectUrl?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to trigger redistricting");
        return;
      }
      router.push(data.redirectUrl ?? regionRedistrictUrl(countryCode, stateId));
    } catch {
      setError("Network error");
    } finally {
      setTriggering(false);
    }
  }

  if (loading || !enabled) return null;

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-red-400">Admin — Redistricting</h3>
          <p className="mt-1 text-xs text-muted">
            Reset this state&apos;s district map to a neutral baseline, then open the map editor.
            Normal governor, trifecta, and census-year gates are bypassed for admins.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleTrigger()}
          disabled={triggering}
          className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
        >
          {triggering ? "Preparing map…" : "Redistrict map →"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
