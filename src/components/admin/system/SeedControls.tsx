"use client";

import { useState } from "react";

export function SeedControls() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; logs?: string[] } | null>(
    null
  );
  const [seedSecret, setSeedSecret] = useState("");

  const handleSeed = async (reset: boolean) => {
    if (!seedSecret.trim()) {
      setResult({ ok: false, message: "Enter your SEED_SECRET first." });
      return;
    }

    if (
      reset &&
      !confirm(
        "DESTRUCTIVE: This runs the legacy /api/seed reset path.\n\nIt drops and reseeds reference-data collections only. It is not the canonical full world bootstrap flow.\n\nContinue?"
      )
    ) {
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const url = reset ? "/api/seed?reset=true" : "/api/seed";
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${seedSecret}` },
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        message: data.message ?? data.error ?? "Unknown response",
        logs: data.logs,
      });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/20">
        <svg
          className="h-6 w-6 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
          />
        </svg>
      </div>
      <h3 className="mb-1 text-lg font-semibold">Seed Database</h3>
      <p className="mb-4 text-sm text-muted">
        Runs the legacy API-key seed route backed by <code>scripts/seed.ts</code>. This is
        reference-data seeding only, not the full runtime bootstrap/reset flow.
      </p>

      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted">SEED_SECRET (from Vercel env vars)</label>
        <input
          type="password"
          value={seedSecret}
          onChange={(e) => setSeedSecret(e.target.value)}
          placeholder="Enter SEED_SECRET..."
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleSeed(false)}
          disabled={loading}
          className="min-h-[44px] rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
        >
          {loading ? "Seeding..." : "Seed (skip if exists)"}
        </button>
        <button
          onClick={() => handleSeed(true)}
          disabled={loading}
          className="min-h-[44px] rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          Force Re-seed (legacy reset)
        </button>
      </div>

      {result && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            result.ok
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          <p className="font-medium">{result.message}</p>
          {result.logs && result.logs.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs opacity-80">
              {result.logs.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
