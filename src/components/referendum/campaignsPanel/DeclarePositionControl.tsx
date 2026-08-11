"use client";

import { useState } from "react";

const card = "rounded-2xl border border-card-border bg-card p-5 shadow-card";

/**
 * For/Against/Withdraw control for an eligible party Chair/Vice. Posts to the
 * position route and reloads; the backend re-authorizes every call.
 */
export function DeclarePositionControl({
  countryId,
  referendumId,
  currentSide,
}: {
  countryId: string;
  referendumId: string;
  currentSide: "yes" | "no" | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/referendum/${referendumId}/position`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Action failed.");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setBusy(false);
    }
  }

  const pill = (active: boolean, tone: string) =>
    `flex-1 rounded-lg border px-3 py-2.5 text-[13px] font-bold transition-colors disabled:opacity-50 ${
      active ? `${tone} text-white` : "border-card-border text-muted hover:text-foreground"
    }`;

  return (
    <div className={card}>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
        Declare your party&apos;s position
      </div>
      {error && (
        <div className="mb-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: "declare", side: "yes" })}
          className={pill(currentSide === "yes", "border-[var(--ref-yes)] bg-[var(--ref-yes)]")}
        >
          For
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: "declare", side: "no" })}
          className={pill(currentSide === "no", "border-[var(--ref-no)] bg-[var(--ref-no)]")}
        >
          Against
        </button>
      </div>
      {currentSide && (
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: "withdraw" })}
          className="mt-2 w-full rounded-lg border border-card-border px-3 py-2 text-[12px] font-semibold text-muted hover:text-foreground disabled:opacity-50"
        >
          Withdraw
        </button>
      )}
    </div>
  );
}
