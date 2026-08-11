"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { TIER_MULTIPLIER } from "@/lib/nationalization/constants";
import { OWNER_LABEL, eligibilityReasons } from "@/lib/nationalization/labels";
import type { NatOfficialActions } from "../NationalCorporationView";
import { natMoney as money } from "../natMoney";

interface Target {
  corporationId: string;
  name: string;
  ownerKind: "player" | "npc";
  triggers: string[];
  sectorCount: number;
  marketCapLocal: number;
  liquidCapitalLocal: number;
  currency: string;
}

type ExecTier = "discounted" | "seizure";

/** What each executive tier pays and the political cost it carries (spec §12). */
const TIER_INFO: Record<ExecTier, { label: string; pays: string; effect: string }> = {
  discounted: {
    label: "Discounted",
    pays: "Pays ~50% of assessed value (the higher of market cap or cash on hand).",
    effect: "a partial hit to investor confidence, public trust, and government legitimacy",
  },
  seizure: {
    label: "Seizure",
    pays: "Pays nothing to the former owner.",
    effect: "the maximum hit to investor confidence, public trust, and government legitimacy",
  },
};

/**
 * Head-of-government nationalization wizard: pick an eligible target (NPC or
 * distressed player corp HQ'd here) and order an executive taking. Broader
 * (solvent) takings go through legislation. Calls POST …/nationalize. Spec §8.
 */
export function NationalizeWizard({ official }: { official: NatOfficialActions }) {
  const code = official.countryId.toLowerCase();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tier, setTier] = useState<ExecTier>("discounted");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const loadTargets = useCallback(async () => {
    setLoadingTargets(true);
    try {
      const res = await fetch(`/api/country/${code}/nationalization-targets`);
      if (res.ok) {
        const data = (await res.json()) as { targets: Target[] };
        setTargets(data.targets);
      }
    } catch {
      /* surfaced via empty list */
    } finally {
      setLoadingTargets(false);
    }
  }, [code]);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const selected = targets.find((t) => t.corporationId === selectedId) ?? null;
  const indicative = selected
    ? Math.max(selected.marketCapLocal, selected.liquidCapitalLocal) * TIER_MULTIPLIER[tier]
    : 0;

  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/country/${code}/nationalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corporationId: selected.corporationId, tier }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Nationalization failed." });
      } else {
        setFeedback({ type: "success", message: `${selected.name} nationalized.` });
        setSelectedId(null);
        official.onRefresh();
        loadTargets();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
      <h3 className="text-body-sm font-semibold uppercase tracking-wide text-gold">
        Nationalize an asset
      </h3>
      <p className="mt-1 text-body-xs text-muted">
        Executive power reaches failing or NPC firms HQ&apos;d here. Solvent private corporations
        require legislation.
      </p>

      {loadingTargets ? (
        <p className="mt-3 text-body-sm text-muted">Loading targets…</p>
      ) : targets.length === 0 ? (
        <p className="mt-3 text-body-sm text-muted">No eligible targets right now.</p>
      ) : (
        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {targets.map((t) => (
            <label
              key={t.corporationId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-card-border bg-card-muted px-3 py-2 text-body-sm"
            >
              <input
                type="radio"
                name="nat-target"
                checked={selectedId === t.corporationId}
                onChange={() => setSelectedId(t.corporationId)}
                disabled={busy}
                className="h-4 w-4"
              />
              <span className="font-medium text-foreground">{t.name}</span>
              <span className="text-body-xs text-muted">
                · {OWNER_LABEL[t.ownerKind]} · {t.sectorCount} sector
                {t.sectorCount === 1 ? "" : "s"}
                {eligibilityReasons(t.triggers) ? ` · ${eligibilityReasons(t.triggers)}` : ""}
              </span>
              <span className="ml-auto text-body-xs text-muted">
                {money(Math.max(t.marketCapLocal, t.liquidCapitalLocal), t.currency)}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-body-sm text-foreground">
          Tier
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as ExecTier)}
            disabled={busy}
            className="rounded border border-card-border bg-card-elevated px-2 py-1"
          >
            <option value="discounted">Discounted</option>
            <option value="seizure">Seizure (no compensation)</option>
          </select>
        </label>
        {selected && (
          <div className="text-body-sm text-muted">
            Indicative compensation:{" "}
            <span className="text-foreground">{money(indicative, selected.currency)}</span>
            <span className="block text-body-xs">
              Final amount computed and debited at execution.
            </span>
          </div>
        )}
        <Button onClick={submit} disabled={!selected || busy}>
          {busy ? "Working…" : "Nationalize"}
        </Button>
      </div>

      {/* Tier effects legend — what each tier pays and its consequences. */}
      <div className="mt-3 space-y-1.5 rounded-lg border border-card-border bg-card-muted/40 p-3 text-body-xs">
        {(Object.keys(TIER_INFO) as ExecTier[]).map((t) => (
          <div key={t} className={`flex gap-2 ${t === tier ? "text-foreground" : "text-muted"}`}>
            <span className="w-20 shrink-0 font-semibold">{TIER_INFO[t].label}</span>
            <span>
              {TIER_INFO[t].pays} For a player-owned firm this carries {TIER_INFO[t].effect}; the
              less you pay, the larger the penalty.
            </span>
          </div>
        ))}
        {selected?.ownerKind === "npc" && (
          <p className="italic text-muted/80">
            This target is NPC-owned — no investor-confidence or political penalty applies at any
            tier, so only the cash cost differs.
          </p>
        )}
      </div>

      {feedback && (
        <p
          className={`mt-3 text-body-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
