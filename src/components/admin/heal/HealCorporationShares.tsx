"use client";

import { useState } from "react";

interface Fix {
  name: string;
  before: number;
  after: number;
}

export function HealCorporationShares() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    fixes?: Fix[];
  } | null>(null);

  const runHeal = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-shares", { method: "POST" });
      const data = await res.json();
      setResult({
        ok: res.ok,
        message: data.message ?? data.error ?? "Unknown response",
        fixes: data.fixes,
      });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Corporation Shares</h3>
        <p className="mt-1 text-xs text-muted">
          Recalculates totalShares for all corporations as shareholder shares + public float +
          reserved sell-order shares. Fixes ownership percentage mismatches.
        </p>
      </div>

      <button
        onClick={runHeal}
        disabled={loading}
        className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
      >
        {loading ? "Healing…" : "Heal Shares"}
      </button>

      {result?.fixes && result.fixes.length > 0 && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-1 text-xs max-h-48 overflow-y-auto">
          <p className="font-medium text-muted mb-2">{result.fixes.length} fix(es)</p>
          {result.fixes.map((f, i) => (
            <p key={i} className="flex justify-between gap-4">
              <span>{f.name}</span>
              <span className="text-muted">
                {f.before.toLocaleString("en-US")} &rarr; {f.after.toLocaleString("en-US")}
              </span>
            </p>
          ))}
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
