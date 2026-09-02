"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { COMMODITY_TYPES, COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import { type CountryId } from "@/lib/constants/countries";
import { useEnabledCountryIds } from "@/lib/hooks/useEnabledCountryIds";
import { formatEmbargoProvisionLabel } from "@/lib/legislature/embargoProvisionLabel";
import {
  TRADE_EMBARGO_CABINET_ACTION_COST,
  TRADE_EMBARGO_MAX_DURATION_TURNS,
  TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER,
} from "@/lib/trade/constants";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

interface EmbargoItem {
  id: string;
  sourceCountry: CountryId;
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
  mode: "block" | "cap";
  cap: number | null;
  origin: "minister" | "legislation";
  expiresTurn: number | null;
}

interface Props {
  countryId: CountryId;
  canAct: boolean;
  /** Cabinet actions left for the seat holder this turn (display only). */
  actionsRemaining: number;
}

const DEFAULT_DURATION = 24;

const inputClass =
  "w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

/**
 * Trade-minister panel for unilateral, temporary embargoes (consumes
 * `/api/world/trade/embargoes`). Durable embargoes are enacted through
 * legislation instead and show here as read-only "by law" entries. Authority is
 * enforced server-side by `requireTradeMinister`; `canAct` only gates the form.
 */
export function TradeEmbargoPanel({ countryId, canAct, actionsRemaining }: Props) {
  const resolveCountryName = useCountryDisplayName();
  const enabledCountryIds = useEnabledCountryIds();
  const targetOptions = enabledCountryIds.filter((id) => id !== countryId);

  const [items, setItems] = useState<EmbargoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const [target, setTarget] = useState<CountryId | "">("");
  const [commodity, setCommodity] = useState<CommodityType | "all">("all");
  const [direction, setDirection] = useState<"export" | "import" | "both">("both");
  const [mode, setMode] = useState<"block" | "cap">("block");
  const [cap, setCap] = useState<number | "">("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [submitting, setSubmitting] = useState(false);
  const [liftingId, setLiftingId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/world/trade/embargoes?country=${countryId}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { items: EmbargoItem[] };
        setItems(data.items ?? []);
      }
    } catch {
      // leave the list as-is; the form still works
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const imposedByUs = items.filter((e) => e.sourceCountry === countryId);
  const imposedOnUs = items.filter(
    (e) => e.targetCountry === countryId && e.sourceCountry !== countryId
  );

  async function handleImpose() {
    if (!canAct || !target) return;
    if (mode === "cap" && !(typeof cap === "number" && cap >= 0)) {
      setFeedback({ type: "error", message: "A capped embargo needs a non-negative cap." });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/world/trade/embargoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCountry: countryId,
          targetCountry: target,
          commodity,
          direction,
          mode,
          ...(mode === "cap" && typeof cap === "number" ? { cap } : {}),
          durationTurns: duration,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Failed to impose embargo." });
        return;
      }
      setFeedback({ type: "success", message: "Embargo imposed — it takes effect next turn." });
      setTarget("");
      setCap("");
      setMode("block");
      setDirection("both");
      setCommodity("all");
      await fetchItems();
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLift(id: string) {
    if (!canAct) return;
    setLiftingId(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/world/trade/embargoes?id=${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Failed to lift embargo." });
        return;
      }
      setFeedback({ type: "success", message: "Embargo lifted." });
      await fetchItems();
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setLiftingId(null);
    }
  }

  function summaryOf(e: EmbargoItem): string {
    return formatEmbargoProvisionLabel({
      type: "embargo",
      targetCountry: e.targetCountry,
      commodity: e.commodity,
      direction: e.direction,
      mode: e.mode,
      ...(e.cap != null ? { cap: e.cap } : {}),
    }).summary;
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Trade Embargoes</h2>
        <p className="mt-1 text-sm text-muted">
          Impose a temporary embargo on another nation&apos;s trade — block a flow outright or cap
          it — to deny them a commodity or refuse their goods. Takes effect next turn and expires
          automatically. Costs {TRADE_EMBARGO_CABINET_ACTION_COST} cabinet action; up to{" "}
          {TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER} active at once, and each target is then on cooldown.
          Durable or repeated embargoes are enacted through trade legislation instead.
        </p>
      </div>

      {/* ── Active embargoes ── */}
      <div className="mb-5 space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Imposed by {resolveCountryName(countryId)}
          </h3>
          {loading ? (
            <ul className="min-h-[88px] space-y-2">
              {[1, 2].map((i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-elevated px-3 py-2"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                  <Skeleton className="h-7 w-16 rounded-lg" />
                </li>
              ))}
            </ul>
          ) : imposedByUs.length === 0 ? (
            <p className="text-sm text-muted/70">No active embargoes.</p>
          ) : (
            <ul className="space-y-2">
              {imposedByUs.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-elevated px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{summaryOf(e)}</p>
                    <p className="text-[11px] text-muted">
                      {e.origin === "legislation" ? "By law" : "Ministerial"}
                      {e.expiresTurn != null ? ` · expires turn ${e.expiresTurn}` : " · no expiry"}
                    </p>
                  </div>
                  {e.origin === "minister" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canAct || liftingId === e.id}
                      isLoading={liftingId === e.id}
                      onClick={() => handleLift(e.id)}
                    >
                      Lift
                    </Button>
                  ) : (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted/70">
                      Repeal via bill
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {imposedOnUs.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Imposed on {resolveCountryName(countryId)}
            </h3>
            <ul className="space-y-2">
              {imposedOnUs.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-card-border bg-card-elevated px-3 py-2"
                >
                  <p className="truncate text-sm text-foreground">
                    {resolveCountryName(e.sourceCountry)}: {summaryOf(e)}
                  </p>
                  <p className="text-[11px] text-muted">
                    {e.origin === "legislation" ? "By law" : "Ministerial"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Impose form ── */}
      <div className="space-y-3 rounded-lg border border-card-border bg-card-elevated p-4">
        <h3 className="text-sm font-semibold text-foreground">Impose an embargo</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="emb-target" className="mb-1 block text-xs font-medium text-muted">
              Target Country
            </label>
            <select
              id="emb-target"
              value={target}
              disabled={!canAct}
              onChange={(e) => setTarget((e.target.value || "") as CountryId | "")}
              className={inputClass}
            >
              <option value="">Select…</option>
              {targetOptions.map((id) => (
                <option key={id} value={id}>
                  {id} — {resolveCountryName(id)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="emb-commodity" className="mb-1 block text-xs font-medium text-muted">
              Commodity
            </label>
            <select
              id="emb-commodity"
              value={commodity}
              disabled={!canAct}
              onChange={(e) => setCommodity(e.target.value as CommodityType | "all")}
              className={inputClass}
            >
              <option value="all">All commodities</option>
              {COMMODITY_TYPES.map((c) => (
                <option key={c} value={c}>
                  {COMMODITY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="emb-direction" className="mb-1 block text-xs font-medium text-muted">
              Direction
            </label>
            <select
              id="emb-direction"
              value={direction}
              disabled={!canAct}
              onChange={(e) => setDirection(e.target.value as "export" | "import" | "both")}
              className={inputClass}
            >
              <option value="both">Both ways</option>
              <option value="export">Our exports to them</option>
              <option value="import">Their imports to us</option>
            </select>
          </div>

          <div>
            <label htmlFor="emb-mode" className="mb-1 block text-xs font-medium text-muted">
              Restriction
            </label>
            <select
              id="emb-mode"
              value={mode}
              disabled={!canAct}
              onChange={(e) => {
                const next = e.target.value as "block" | "cap";
                setMode(next);
                if (next === "block") setCap("");
              }}
              className={inputClass}
            >
              <option value="block">Block (stop the flow)</option>
              <option value="cap">Cap (limit the flow)</option>
            </select>
          </div>

          {mode === "cap" && (
            <div>
              <label htmlFor="emb-cap" className="mb-1 block text-xs font-medium text-muted">
                Cap (units)
              </label>
              <input
                id="emb-cap"
                type="number"
                min={0}
                step={1000}
                value={cap}
                disabled={!canAct}
                onChange={(e) => setCap(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="emb-duration" className="mb-1 block text-xs font-medium text-muted">
              Duration (turns)
            </label>
            <input
              id="emb-duration"
              type="number"
              min={1}
              max={TRADE_EMBARGO_MAX_DURATION_TURNS}
              value={duration}
              disabled={!canAct}
              onChange={(e) =>
                setDuration(
                  Math.max(
                    1,
                    Math.min(TRADE_EMBARGO_MAX_DURATION_TURNS, Number(e.target.value) || 1)
                  )
                )
              }
              className={inputClass}
            />
            <p className="mt-1 text-[11px] italic text-muted/60">
              Max {TRADE_EMBARGO_MAX_DURATION_TURNS} turns — use legislation for a durable embargo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!canAct || !target || submitting}
            isLoading={submitting}
            onClick={handleImpose}
          >
            Impose Embargo
          </Button>
          {canAct ? (
            <span className="text-xs text-muted">
              Costs {TRADE_EMBARGO_CABINET_ACTION_COST} cabinet action · {actionsRemaining}{" "}
              remaining
            </span>
          ) : (
            <span className="text-xs text-muted">
              Only the trade minister (or head of government) may impose embargoes.
            </span>
          )}
          {feedback && (
            <span
              className={`text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
            >
              {feedback.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
