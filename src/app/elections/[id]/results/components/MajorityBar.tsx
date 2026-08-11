"use client";

export interface MajorityBarSegment {
  id: string;
  label: string;
  color: string;
  /** Solid (called EV / declared seats). */
  value: number;
  /** Translucent extension (leading EV / projected-but-undeclared seats). */
  softValue?: number;
}

interface MajorityBarProps {
  segments: MajorityBarSegment[];
  total: number;
  threshold: number;
  thresholdLabel: string;
}

/**
 * The election-night bar: solid fills for decided totals, translucent fills
 * for projections, and the majority marker. Left group descends from the
 * front-runner; the runner-up is mirrored from the right, like TV EV bars.
 */
export function MajorityBar({ segments, total, threshold, thresholdLabel }: MajorityBarProps) {
  if (total <= 0) return null;
  const sorted = [...segments].sort(
    (a, b) => b.value + (b.softValue ?? 0) - (a.value + (a.softValue ?? 0))
  );
  const right = sorted.length > 1 ? sorted[1] : null;
  const leftGroup = sorted.filter((s) => s !== right);
  const pct = (v: number) => `${(v / total) * 100}%`;

  return (
    <div>
      <div className="relative h-10 overflow-hidden rounded-lg bg-card-border/50">
        <div className="absolute inset-0 flex">
          {leftGroup.map((s) => (
            <div
              key={s.id}
              className="flex h-full"
              style={{ width: pct(s.value + (s.softValue ?? 0)) }}
            >
              <div
                className="h-full transition-[width] duration-1000 ease-out"
                style={{
                  width: pct2(s.value, s.value + (s.softValue ?? 0)),
                  backgroundColor: s.color,
                }}
              />
              {s.softValue ? (
                <div
                  className="h-full flex-1 transition-[width] duration-1000 ease-out"
                  style={{ backgroundColor: s.color, opacity: 0.35 }}
                />
              ) : null}
            </div>
          ))}
        </div>
        {right && (
          <div
            className="absolute inset-y-0 right-0 flex flex-row-reverse"
            style={{ width: pct(right.value + (right.softValue ?? 0)) }}
          >
            <div
              className="h-full transition-[width] duration-1000 ease-out"
              style={{
                width: pct2(right.value, right.value + (right.softValue ?? 0)),
                backgroundColor: right.color,
              }}
            />
            {right.softValue ? (
              <div
                className="h-full flex-1 transition-[width] duration-1000 ease-out"
                style={{ backgroundColor: right.color, opacity: 0.35 }}
              />
            ) : null}
          </div>
        )}
        {/* Majority marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground/70"
          style={{ left: pct(threshold) }}
        />
      </div>
      <div
        className="mt-1 -translate-x-1/2 text-[10px] font-semibold text-muted tabular-nums"
        style={{ marginLeft: pct(threshold), width: "fit-content" }}
      >
        {thresholdLabel}
      </div>
    </div>
  );
}

/** Inner solid width as a % of its own (solid+soft) group. */
function pct2(solid: number, groupTotal: number): string {
  if (groupTotal <= 0) return "0%";
  return `${(solid / groupTotal) * 100}%`;
}
