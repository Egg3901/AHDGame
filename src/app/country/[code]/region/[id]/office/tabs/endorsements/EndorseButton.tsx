"use client";

import { useState } from "react";

interface Props {
  countryId: string;
  stateId: string;
  electionId: string;
  candidateId: string;
  disabled: boolean;
  /** Shown as the button title when disabled (e.g. cross-party vs insufficient AP). */
  disabledReason?: string;
  label: string;
  onSuccess: () => void;
  /** Override the default state-governor endpoint with a different URL
   *  (e.g. `/api/country/us/executive/endorsements` for the head-of-
   *  government endorsement flow). When set, only `electionId` and
   *  `candidateId` are posted — no region path segment is appended. */
  endpoint?: string;
}

export function EndorseButton({
  countryId,
  stateId,
  electionId,
  candidateId,
  disabled,
  disabledReason,
  label,
  onSuccess,
  endpoint,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const url =
      endpoint ??
      `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/endorsements`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ electionId, candidateId }),
    });
    if (res.ok) onSuccess();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Endorse failed.");
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        onClick={go}
        disabled={disabled || busy}
        className="rounded-lg border border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
        title={disabled && !busy ? (disabledReason ?? "") : ""}
      >
        {busy ? "Endorsing…" : label}
      </button>
      {error && <span className="text-xs text-error max-w-[200px] text-right">{error}</span>}
    </span>
  );
}
