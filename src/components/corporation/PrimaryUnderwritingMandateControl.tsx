"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/errors/catalog";

interface BankChoice {
  corporationId: string;
  name: string;
  currencyCode: string;
  charteredTurn: number;
  feeRate: number;
}

interface Payload {
  enabled: boolean;
  selectedBankId: string | null;
  banks: BankChoice[];
}

/** The issuer CEO selects a bank once; the mandate applies to future equity and bond offers. */
export function PrimaryUnderwritingMandateControl({ corpId }: { corpId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    void fetch(`/api/corporations/${corpId}/underwriting`)
      .then(async (response) => {
        const body = (await response.json()) as Payload;
        if (!live || !response.ok || !body.enabled) return;
        setPayload(body);
        setSelected(body.selectedBankId ?? "");
      })
      .catch(() => {
        if (live) setMessage("Bank choices could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [corpId]);

  if (!payload?.enabled) return null;

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/corporations/${corpId}/underwriting`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCorporationId: selected || null }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(apiErrorText(body, "The mandate could not be saved."));
      setMessage(selected ? "Underwriting mandate saved." : "Underwriting mandate cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The mandate could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4"
      aria-label="Primary underwriting"
    >
      <div className="mb-2 text-sm font-semibold">Primary market underwriting</div>
      <p className="mb-3 text-xs text-muted">
        Select a same-currency investment bank for future share and bond placements. The bank fee
        applies only to proceeds the market actually funds.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Underwriting bank"
          className="min-h-9 min-w-56 rounded-md border border-border bg-background px-2 text-sm"
          value={selected}
          disabled={payload.banks.length === 0 && !payload.selectedBankId}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">No selected bank</option>
          {payload.banks.map((bank) => (
            <option key={bank.corporationId} value={bank.corporationId}>
              {bank.name} ({(bank.feeRate * 100).toFixed(2)}%)
            </option>
          ))}
        </select>
        <button
          type="button"
          className="min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-50"
          disabled={busy || selected === (payload.selectedBankId ?? "")}
          onClick={() => void save()}
        >
          {busy ? "Saving" : "Save mandate"}
        </button>
        {message && (
          <span role="status" className="text-xs text-muted">
            {message}
          </span>
        )}
      </div>
      {payload.banks.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          No investment or universal bank is chartered in this currency yet. Retail banks do not
          underwrite placements, and shares and bonds still sell to the market without a mandate.
          For a corporate loan, use private bank credit on the{" "}
          <Link href="/banking" className="underline">
            Banking page
          </Link>
          .
        </p>
      )}
    </section>
  );
}
