"use client";

import { useState, useCallback } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";

type Selected = { id: string; name: string } | null;

interface ImfInstitutionSeedFormProps {
  /** After successful seed/repair */
  onSuccess?: () => void | Promise<void>;
  compact?: boolean;
}

export function ImfInstitutionSeedForm({ onSuccess, compact }: ImfInstitutionSeedFormProps) {
  const [shareholder1, setShareholder1] = useState<Selected>(null);
  const [shareholder2, setShareholder2] = useState<Selected>(null);
  const [ceoIsFirst, setCeoIsFirst] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = shareholder1 && shareholder2;

  const submit = useCallback(async () => {
    if (!shareholder1 || !shareholder2) {
      setError("Select two shareholders.");
      return;
    }
    const ceoId = ceoIsFirst ? shareholder1.id : shareholder2.id;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/imf/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ceoCharacterId: ceoId,
          shareholderCharacterIds: [shareholder1.id, shareholder2.id],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const parts: string[] = [];
      if (data.created) parts.push("Created IMF corporation.");
      else if (data.updated) parts.push("Updated IMF ownership.");
      else parts.push("No changes needed (already matched).");
      setMessage(parts.join(" "));
      await onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [shareholder1, shareholder2, ceoIsFirst, onSuccess]);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <p className="text-sm text-muted">
        Pick two characters (distinct accounts). Choose which one is CEO. Initial cap table is an
        even split ({compact ? "50/50" : "50% / 50%"}). IMF uses a US / USD HQ and is hidden from
        the exchange.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Shareholder 1</label>
          {shareholder1 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card/50 px-3 py-2 text-sm">
              <span>{shareholder1.name}</span>
              <button
                type="button"
                onClick={() => setShareholder1(null)}
                className="text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : (
            <PlayerSelector
              placeholder="Search character…"
              excludeIds={shareholder2 ? [shareholder2.id] : []}
              onSelect={(c) => setShareholder1({ id: c.id, name: c.name })}
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Shareholder 2</label>
          {shareholder2 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card/50 px-3 py-2 text-sm">
              <span>{shareholder2.name}</span>
              <button
                type="button"
                onClick={() => setShareholder2(null)}
                className="text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : (
            <PlayerSelector
              placeholder="Search character…"
              excludeIds={shareholder1 ? [shareholder1.id] : []}
              onSelect={(c) => setShareholder2({ id: c.id, name: c.name })}
            />
          )}
        </div>
      </div>

      {canSubmit && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">
            CEO (must be shareholder 1 or 2)
          </legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="imf-ceo"
                checked={ceoIsFirst}
                onChange={() => setCeoIsFirst(true)}
                className="border-card-border"
              />
              {shareholder1.name}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="imf-ceo"
                checked={!ceoIsFirst}
                onChange={() => setCeoIsFirst(false)}
                className="border-card-border"
              />
              {shareholder2.name}
            </label>
          </div>
        </fieldset>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit || loading}
        className="min-h-[44px] rounded-lg border border-primary bg-primary/10 px-6 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Saving…" : "Create or repair IMF institution"}
      </button>

      {message && (
        <p className="text-sm text-green-400" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
