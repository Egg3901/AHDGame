"use client";

const DONUT_R = 16;
const DONUT_C = 2 * Math.PI * DONUT_R; // ~100.53

export function VoteDonut({
  votesFor,
  votesAgainst,
  votesAbstain,
  label,
  size = 48,
}: {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  label?: string;
  size?: number;
}) {
  const total = votesFor + votesAgainst + votesAbstain;
  const pctFor = total > 0 ? votesFor / total : 0;
  const pctAgainst = total > 0 ? votesAgainst / total : 0;
  const pctAbstain = total > 0 ? votesAbstain / total : 0;

  const forLen = pctFor * DONUT_C;
  const againstLen = pctAgainst * DONUT_C;
  const abstainLen = pctAbstain * DONUT_C;

  const forOffset = 0;
  const againstOffset = -forLen;
  const abstainOffset = -(forLen + againstLen);

  const centerLabel = total > 0 ? `${Math.round(pctFor * 100)}%` : "—";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden
      >
        {/* Track */}
        <circle
          cx="24"
          cy="24"
          r={DONUT_R}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-card-border"
          strokeDasharray={`${DONUT_C} ${DONUT_C}`}
        />
        {total > 0 && (
          <>
            {/* For */}
            {forLen > 0 && (
              <circle
                cx="24"
                cy="24"
                r={DONUT_R}
                fill="none"
                stroke="#22c55e"
                strokeWidth="8"
                strokeDasharray={`${forLen} ${DONUT_C - forLen}`}
                strokeDashoffset={forOffset}
              />
            )}
            {/* Against */}
            {againstLen > 0 && (
              <circle
                cx="24"
                cy="24"
                r={DONUT_R}
                fill="none"
                stroke="#ef4444"
                strokeWidth="8"
                strokeDasharray={`${againstLen} ${DONUT_C - againstLen}`}
                strokeDashoffset={againstOffset}
              />
            )}
            {/* Abstain */}
            {abstainLen > 0 && (
              <circle
                cx="24"
                cy="24"
                r={DONUT_R}
                fill="none"
                stroke="#6b7280"
                strokeWidth="8"
                strokeDasharray={`${abstainLen} ${DONUT_C - abstainLen}`}
                strokeDashoffset={abstainOffset}
              />
            )}
          </>
        )}
        {/* Center text — counter-rotate to keep upright */}
        <text
          x="24"
          y="24"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9"
          fontWeight="700"
          fill="currentColor"
          className="text-foreground"
          style={{ transform: "rotate(90deg)", transformOrigin: "24px 24px" }}
        >
          {centerLabel}
        </text>
      </svg>
      {label && <span className="text-[9px] text-muted leading-none">{label}</span>}
    </div>
  );
}
