"use client";

const DEFAULT_CORP_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#f97316",
];

interface MarketPieProps {
  myShare: number;
  myColor: string;
  competitors: {
    corporationId?: string;
    corporationName: string;
    brandColor?: string;
    marketShare: number;
  }[];
  unownedPercent: number;
  size?: number;
}

export default function MarketPie({
  myShare,
  myColor,
  competitors,
  unownedPercent,
  size = 120,
}: MarketPieProps) {
  const radius = Math.round(size * 0.4);
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = Math.round(size * 0.2);
  const circumference = 2 * Math.PI * radius;

  const segments: { percent: number; color: string; label: string }[] = [
    { percent: myShare, color: myColor, label: "You" },
  ];
  competitors.forEach((comp, i) => {
    if (comp.marketShare > 0) {
      segments.push({
        percent: comp.marketShare,
        color: comp.brandColor || DEFAULT_CORP_COLORS[i % DEFAULT_CORP_COLORS.length],
        label: comp.corporationName,
      });
    }
  });
  if (unownedPercent > 0) {
    segments.push({ percent: unownedPercent, color: "rgba(128,128,128,0.2)", label: "Unowned" });
  }

  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg, i) => {
        const dashLength = (seg.percent / 100) * circumference;
        const dashOffset = -offset;
        offset += dashLength;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashLength} ${circumference - dashLength}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <title>{`${seg.label}: ${seg.percent.toFixed(1)}%`}</title>
          </circle>
        );
      })}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="fill-foreground text-sm font-bold"
        fontSize="14"
      >
        {myShare.toFixed(1)}%
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted text-[9px]" fontSize="9">
        your share
      </text>
    </svg>
  );
}
