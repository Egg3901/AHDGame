"use client";

import { useState } from "react";

interface CorpDiagnostic {
  id: string;
  name: string;
  liquidCapital: number;
}

export function HealCorporationCash() {
  const [loading, setLoading] = useState(false);
  const [corps, setCorps] = useState<CorpDiagnostic[] | null>(null);
  const [amount, setAmount] = useState("100000");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-cash");
      const data = await res.json();
      if (res.ok) {
        setCorps(data.corporations);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async () => {
    const parsed = Number(amount);
    if (isNaN(parsed) || parsed < 0) {
      setResult({ ok: false, message: "Enter a valid positive number" });
      return;
    }

    if (
      !confirm(
        `This will set liquidCapital to $${parsed.toLocaleString("en-US")} for ALL corporations.\n\nContinue?`
      )
    )
      return;

    setLoading(true);
    setCorps(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/corporation-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liquidCapital: parsed }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Corporation Cash</h3>
        <p className="mt-1 text-xs text-muted">
          Sets liquidCapital to a specific amount for all corporations. Use to reset corporate
          finances after bugs or for testing.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs">
          <label htmlFor="corp-cash-amount" className="block text-xs text-muted mb-1">
            Liquid Capital ($)
          </label>
          <input
            id="corp-cash-amount"
            type="number"
            min="0"
            max="1000000000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-xs"
          />
        </div>
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Setting…" : "Set All"}
        </button>
      </div>

      {corps && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-1 text-xs max-h-48 overflow-y-auto">
          <p className="font-medium text-muted mb-2">{corps.length} corporation(s)</p>
          {corps.map((c) => (
            <p key={c.id} className="flex justify-between">
              <span>{c.name}</span>
              <span className={c.liquidCapital < 0 ? "text-error font-medium" : "text-muted"}>
                ${c.liquidCapital.toLocaleString("en-US")}
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
