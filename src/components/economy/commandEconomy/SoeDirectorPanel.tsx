"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Slider } from "@/components/ui";
import { formatCompactNumber } from "@/lib/utils/formatters";
import {
  soeCapacityAdvice,
  type CommandEconomyDashboard,
  type SoeView,
} from "@/lib/economy/commandEconomyDashboard";

interface Props {
  dashboard: CommandEconomyDashboard;
  soe: SoeView;
  onSaved: () => void;
}

/**
 * SOE Director panel — one per enterprise the player directs. Set a production
 * target, choose the labour-vs-quality tradeoff, and request investment from
 * Gosbank. Writes soe.planTarget + soe.directive.
 */
export function SoeDirectorPanel({ dashboard, soe, onSaved }: Props) {
  const [target, setTarget] = useState(String(Math.round(soe.planTarget)));
  const [labor, setLabor] = useState(Math.round(soe.laborQuality * 100));
  const [request, setRequest] = useState(String(Math.round(soe.investmentRequest)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { laborQuality: labor / 100 };
      const t = Number(target);
      if (Number.isFinite(t) && t >= 0) body.planTarget = t;
      const r = Number(request);
      if (Number.isFinite(r) && r >= 0) body.investmentRequest = r;
      const res = await fetch(
        `/api/country/${dashboard.countryId.toLowerCase()}/command-economy/soe/${soe.corpId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const under = soe.planFulfillment < 0.9;
  const requestValue = Number(request);
  const capacityAdvice = soeCapacityAdvice({
    output: soe.output,
    capacity: soe.capacity,
    investmentRequest: Number.isFinite(requestValue) ? requestValue : soe.investmentRequest,
  });

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-foreground">{soe.corpName}</h3>
        <Badge color="success" variant="subtle">
          {soe.sectorLabel}
        </Badge>
        <Badge color={under ? "warning" : "default"} variant="subtle">
          {Math.round(soe.planFulfillment * 100)}% of plan
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-card-border bg-card-muted/30 p-3 text-center">
        <Readout label="Output" value={formatCompactNumber(soe.output)} />
        <Readout label="Efficiency" value={`${Math.round(soe.efficiency * 100)}%`} />
        <Readout label="Losses" value={formatCompactNumber(soe.cumulativeLosses)} />
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-foreground">Production target</label>
          <input
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-muted">
            A stretch target above capacity pushes output but risks missing the plan.
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">Labour vs quality</span>
            <span className="tabular-nums text-muted">
              {labor < 40 ? "Quantity" : labor > 60 ? "Quality" : "Balanced"}
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            value={labor}
            onChange={(e) => setLabor(Number(e.target.value))}
          />
          <p className="mt-1 text-[10px] text-muted">
            Chase raw output on the left, chase efficiency and quality on the right.
          </p>
        </div>
        <div>
          <label className="text-xs font-semibold text-foreground">Investment request</label>
          <input
            type="number"
            min={0}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-muted">
            Ask Gosbank for capital. A request draws more directed credit toward this plant.
          </p>
          {capacityAdvice && (
            <div
              className={`mt-2 rounded-lg border p-3 text-[11px] leading-snug ${
                capacityAdvice.severity === "warning"
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-card-border bg-card-muted/40 text-muted"
              }`}
              aria-live="polite"
            >
              <p className="font-semibold text-foreground">Excess capacity</p>
              <p className="mt-1">{capacityAdvice.message}</p>
              <Link
                href={`/corporation/${soe.corpId}`}
                className="mt-2 inline-block font-semibold text-primary hover:underline"
              >
                Open enterprise plants
              </Link>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-error">{error}</p>}
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Update enterprise"}
        </Button>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export default SoeDirectorPanel;
