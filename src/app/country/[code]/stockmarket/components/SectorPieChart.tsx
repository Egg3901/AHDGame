"use client";

/**
 * Simple pie chart for sector share (market cap %). Same geometry as election PieChart; kept local to avoid coupling to elections routes.
 */
export function SectorPieChart({
  slices,
  size = 200,
}: {
  slices: { label: string; pct: number; color: string }[];
  size?: number;
}) {
  if (slices.length === 0) return null;
  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 2} fill={slices[0].color} />
      </svg>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  type SliceWithAngles = {
    label: string;
    pct: number;
    color: string;
    startAngle: number;
    endAngle: number;
    angle: number;
  };
  const { items: computedSlices } = slices.reduce<{ items: SliceWithAngles[]; nextAngle: number }>(
    (acc, s) => {
      const share = s.pct / 100;
      const angle = share * 2 * Math.PI;
      const startAngle = acc.nextAngle;
      const endAngle = acc.nextAngle + angle;
      acc.items.push({ ...s, startAngle, endAngle, angle });
      acc.nextAngle = endAngle;
      return acc;
    },
    { items: [], nextAngle: -Math.PI / 2 }
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {computedSlices.map((s, i) => {
        const { startAngle, endAngle, angle } = s;
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const largeArc = angle > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
            fill={s.color}
            stroke="var(--card-border)"
            strokeWidth={1}
          >
            <title>{`${s.label}: ${s.pct.toFixed(1)}%`}</title>
          </path>
        );
      })}
    </svg>
  );
}
