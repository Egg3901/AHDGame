"use client";

export function NavChangeBadge({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-xs text-muted">—</span>;
  }
  const positive = value > 0;
  const negative = value < 0;
  return (
    <div
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
        positive
          ? "bg-success/10 text-success"
          : negative
            ? "bg-error/10 text-error"
            : "bg-muted/10 text-muted"
      }`}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </div>
  );
}
