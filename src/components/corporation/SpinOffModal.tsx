"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { spinOffCostAnchor } from "@/lib/corporations/subsidiaries/constants";
import { PlayerSelector } from "@/components/PlayerSelector";
import { useDialogA11y } from "@/components/ui";

interface SpinOffModalProps {
  corporationId: string;
  /** The parent's sector types and how many sectors of each it operates. */
  sectorOptions: { type: string; count: number }[];
  onClose: () => void;
  onSpunOff: (newCorporationId: string) => void;
}

/**
 * Spin off one of the parent's sector types into a new wholly-owned private
 * subsidiary. The new corp is run by a different player or an NPP caretaker.
 */
export function SpinOffModal({
  corporationId,
  sectorOptions,
  onClose,
  onSpunOff,
}: SpinOffModalProps) {
  const { dialogProps, titleId } = useDialogA11y(onClose);
  const { formatAmount } = useCurrency();

  const [sectorType, setSectorType] = useState<string>(sectorOptions[0]?.type ?? "");
  const [name, setName] = useState("");
  const [tickerSymbol, setTickerSymbol] = useState("");
  const [ceoType, setCeoType] = useState<"npp" | "character">("npp");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selectedCount = sectorOptions.find((o) => o.type === sectorType)?.count ?? 0;
  const estimatedCostAnchor = spinOffCostAnchor(selectedCount);

  async function handleSubmit() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/subsidiary/spin-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectorType,
          name: name.trim(),
          tickerSymbol: tickerSymbol.trim() || undefined,
          appointedCeoType: ceoType,
          ...(ceoType === "character" ? { appointedCeoCharacterId: selected?.id } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Spin-off failed");
        return;
      }
      onSpunOff(data.newCorporationId);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...dialogProps}
    >
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-5 space-y-4">
        <h2 id={titleId} className="text-base font-bold text-foreground">
          Spin off a subsidiary
        </h2>
        <p className="text-xs text-muted">
          Move all sectors of one type into a new, wholly-owned private corporation run by a
          different CEO. Estimated cost: {formatAmount(estimatedCostAnchor)}
          {selectedCount > 0 && (
            <>
              {" "}
              ({selectedCount} sector{selectedCount === 1 ? "" : "s"} moved)
            </>
          )}
          .
        </p>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Sector type</label>
          <select
            value={sectorType}
            onChange={(e) => setSectorType(e.target.value)}
            className="rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm"
          >
            {sectorOptions.map((o) => (
              <option key={o.type} value={o.type}>
                {CORPORATION_TYPE_LABELS[o.type as CorporationType] ?? o.type} ({o.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">New corporation name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Ticker (optional)</label>
          <input
            type="text"
            value={tickerSymbol}
            onChange={(e) => setTickerSymbol(e.target.value.toUpperCase())}
            maxLength={5}
            className="rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="spinoffCeo"
              checked={ceoType === "npp"}
              onChange={() => setCeoType("npp")}
            />
            NPP caretaker (auto-selected)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="spinoffCeo"
              checked={ceoType === "character"}
              onChange={() => setCeoType("character")}
            />
            Player character
          </label>
          {ceoType === "character" && (
            <div className="space-y-2">
              <PlayerSelector
                placeholder="Search for a player by name…"
                onSelect={(c) => {
                  setSelected({ id: c.id, name: c.name });
                  setErr("");
                }}
              />
              {selected && (
                <p className="text-xs text-muted">
                  Selected: <span className="font-semibold text-foreground">{selected.name}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {err && <p className="text-xs text-error">{err}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              busy ||
              !sectorType ||
              name.trim().length === 0 ||
              (ceoType === "character" && !selected)
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Spin off"}
          </button>
        </div>
      </div>
    </div>
  );
}
