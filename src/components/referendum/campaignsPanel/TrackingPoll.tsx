import type { PollPoint } from "@/lib/referendum/pollSnapshot";
import { buildPollPath } from "@/lib/referendum/pollChart";

const W = 600;
const H = 220;

/**
 * Detail-page tracking poll: the Yes-share series on a FIXED 0–100 axis with a
 * solid 50% pass-threshold line, so movement reads true-to-scale and you can
 * see how close the race is. Under two readings, a neutral placeholder.
 */
export function TrackingPoll({ history }: { history: PollPoint[] }) {
  const d = buildPollPath(history, W, H);
  if (!d) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-card-border text-sm text-muted">
        Tracking poll opens once the campaign has polled for a few turns.
      </div>
    );
  }
  const midY = H / 2;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted">
        <span>Tracking poll · Yes %</span>
        <span>0–100 scale</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Referendum tracking poll"
      >
        <defs>
          <linearGradient id="pollFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ref-yes)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--ref-yes)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines at 0 / 50 / 100 */}
        <line x1="0" y1="0.5" x2={W} y2="0.5" stroke="var(--card-border)" strokeWidth="1" />
        <line
          data-ref="threshold"
          x1="0"
          y1={midY}
          x2={W}
          y2={midY}
          stroke="var(--ref-amber)"
          strokeWidth="1.5"
        />
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--card-border)" strokeWidth="1" />
        {/* filled area under the line */}
        <path data-ref="poll-area" d={`${d} L ${W} ${H} L 0 ${H} Z`} fill="url(#pollFill)" />
        <path
          data-ref="poll-line"
          d={d}
          fill="none"
          stroke="var(--ref-yes)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span>Campaign open</span>
        <span className="text-[var(--ref-amber)]">50% to pass</span>
        <span>Now</span>
      </div>
    </div>
  );
}
