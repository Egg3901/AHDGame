import type { PollPoint } from "@/lib/referendum/pollSnapshot";
import { buildPollPath } from "@/lib/referendum/pollChart";

const W = 100;
const H = 34;

/**
 * Inline trend sparkline on a fixed 0–100 scale with a faint 50% line. With
 * fewer than two readings it falls back to the inert dashed baseline so the
 * Briefing table keeps the Sub-project A look until data accrues.
 */
export function Sparkline({ history }: { history: PollPoint[] }) {
  const d = buildPollPath(history, W, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
      <line
        x1="0"
        y1={H / 2}
        x2={W}
        y2={H / 2}
        stroke="var(--card-border)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      {d && (
        <path
          data-ref="spark-line"
          d={d}
          fill="none"
          stroke="var(--ref-yes)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
