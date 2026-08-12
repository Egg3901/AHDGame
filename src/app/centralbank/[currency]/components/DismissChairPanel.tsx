"use client";

import { useState } from "react";
import { INDEPENDENCE_COSTS, DISMISSAL_SCRUTINY } from "@/lib/centralBank/independence";

/**
 * The independence fight, from the government's side.
 *
 * Shown only to a seated executive, and only for a national bank: a shared bank
 * has no single government to dismiss its chair, and the API path this posts to
 * is country-scoped.
 *
 * The full price ladder is on the card on purpose. Taking a central bank should
 * be a decision, not a discovery.
 */
export function DismissChairPanel({
  chairTitle,
  chairName,
  bankApiBasePath,
  onChanged,
}: {
  chairTitle: string;
  chairName: string;
  bankApiBasePath: string;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Country-scoped only. An intorg bank (the ECB) answers to no single cabinet.
  if (!bankApiBasePath.startsWith("/api/country/")) return null;

  async function dismiss() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`${bankApiBasePath}/dismiss-chair`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) setErr(d.error || "Dismissal failed");
      else {
        setConfirming(false);
        onChanged();
      }
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 rounded-xl border border-card-border bg-card p-5">
      <h2 className="mb-3 break-words text-xs font-semibold uppercase tracking-widest text-muted">
        Independence
      </h2>

      <p className="text-sm text-foreground">
        You can remove {chairName} as {chairTitle}. The bank keeps every point of scrutiny it has
        already earned and takes {DISMISSAL_SCRUTINY} more.
      </p>
      <p className="mt-2 text-xs text-muted">
        Waiting out the term is cheaper: an expired term or a resignation leaves the institution
        with 75% of its scrutiny. There is no arrangement of people that erases the record.
      </p>

      <table className="mt-3 w-full text-xs">
        <tbody>
          {INDEPENDENCE_COSTS.map((cost) => (
            <tr key={cost.action} className="border-t border-card-border/60">
              <td className="py-1.5 pr-2 text-foreground">{cost.action}</td>
              <td className="py-1.5 text-right font-semibold text-warning">+{cost.scrutiny}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {err && <p className="mt-2 text-xs text-error">{err}</p>}

      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            className="rounded-lg bg-error px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Dismissing…" : `Confirm: dismiss ${chairName}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-error/40 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/10"
        >
          Dismiss the {chairTitle}
        </button>
      )}
    </div>
  );
}
