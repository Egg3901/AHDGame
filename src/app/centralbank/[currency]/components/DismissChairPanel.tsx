"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useState } from "react";
import { INDEPENDENCE_COSTS, DISMISSAL_SCRUTINY } from "@/lib/centralBank/independence";
import { CentralBankSection } from "./CentralBankSection";

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
      if (!res.ok) setErr(apiErrorText(d, "Dismissal failed"));
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
    <CentralBankSection title="Independence" level="aside">
      <p className="text-body text-foreground">
        You can remove {chairName} as {chairTitle}. The bank keeps every point of scrutiny it has
        already earned and takes {DISMISSAL_SCRUTINY} more.
      </p>
      <p className="mt-2 text-body-sm text-muted">
        Waiting out the term is cheaper: an expired term or a resignation leaves the institution
        with 75% of its scrutiny. There is no arrangement of people that erases the record.
      </p>

      <table className="mt-3 w-full text-body-sm">
        <tbody>
          {INDEPENDENCE_COSTS.map((cost) => (
            <tr key={cost.action} className="border-t border-card-border/60">
              <td className="py-1.5 pr-2 text-foreground">{cost.action}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-warning">
                +{cost.scrutiny}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {err && <p className="mt-2 text-body-sm text-error">{err}</p>}

      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            className="rounded-md bg-error px-3 py-1.5 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Dismissing…" : `Confirm: dismiss ${chairName}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-md border border-error/40 px-3 py-1.5 text-body-sm font-semibold text-error hover:bg-error/10"
        >
          Dismiss the {chairTitle}
        </button>
      )}
    </CentralBankSection>
  );
}
