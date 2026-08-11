import type { CrossPressureForces } from "@/lib/db/types";

/**
 * Stacked horizontal bar visualising the four cross-pressure forces (ideology,
 * party whip, home district, donors) on a shared -100..+100 axis. The bar's
 * centre divider marks zero; positive forces extend right, negatives left, and
 * a verdict marker line shows where the net sum lands.
 *
 * Used by `NppForecastCard` (single-NPP profile view).
 */

interface ForceBarProps {
  forces: CrossPressureForces;
  /** Hide the per-force legend row. Use in compact list rows where space is at a premium. */
  hideLegend?: boolean;
}

const FORCE_LABELS: Array<{
  key: keyof CrossPressureForces;
  label: string;
  color: string;
}> = [
  { key: "ideology", label: "Ideology", color: "#9d6dc9" },
  { key: "whip", label: "Party whip", color: "#d04848" },
  { key: "district", label: "Home district", color: "#3a7bd5" },
  { key: "donors", label: "Donors", color: "#d9a13a" },
];

/**
 * Clamp a numeric force into [-100, +100]. The cross-pressure resolver should
 * already produce values in-range, but render-time clamping keeps the bar safe
 * against any drift from the persisted snapshot.
 */
function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n > 100) return 100;
  if (n < -100) return -100;
  return n;
}

export function CrossPressureForceBar({ forces, hideLegend = false }: ForceBarProps) {
  const safe: CrossPressureForces = {
    ideology: clamp(forces.ideology),
    whip: clamp(forces.whip),
    district: clamp(forces.district),
    donors: clamp(forces.donors),
  };
  const sum = safe.ideology + safe.whip + safe.district + safe.donors;
  const positives = FORCE_LABELS.map(({ key, color }) => ({
    key,
    color,
    value: safe[key],
  })).filter((f) => f.value > 0);
  const negatives = FORCE_LABELS.map(({ key, color }) => ({
    key,
    color,
    value: safe[key],
  })).filter((f) => f.value < 0);
  const totalPositive = positives.reduce((s, f) => s + f.value, 0);
  const totalNegative = Math.abs(negatives.reduce((s, f) => s + f.value, 0));
  const maxScale = Math.max(totalPositive, totalNegative, 100);
  const verdictTone = sum > 5 ? "#2f8a5b" : sum < -5 ? "#d04848" : "#888";

  return (
    <div className="space-y-2">
      <div className="relative flex h-7 w-full items-stretch overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
        <div className="flex flex-1 justify-end">
          {negatives.map((f) => (
            <div
              key={f.key}
              title={`${f.key}: ${f.value}`}
              style={{
                width: `${(Math.abs(f.value) / maxScale) * 50}%`,
                background: f.color,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <div className="w-px bg-zinc-700" />
        <div className="flex flex-1">
          {positives.map((f) => (
            <div
              key={f.key}
              title={`${f.key}: ${f.value}`}
              style={{
                width: `${(f.value / maxScale) * 50}%`,
                background: f.color,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <div
          className="absolute top-0 bottom-0 w-0.5"
          style={{
            left: `${50 + (sum / maxScale) * 50}%`,
            background: verdictTone,
            boxShadow: "0 0 0 1px #18181b",
          }}
        />
      </div>
      {!hideLegend && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-400">
          {FORCE_LABELS.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: f.color }} />
              {f.label}: <span className="tabular-nums text-foreground">{safe[f.key]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
