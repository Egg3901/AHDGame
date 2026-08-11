// Row in a StatusBar chip tooltip's breakdown table — label on the left,
// numeric value on the right. Extracted from src/components/StatusBar.tsx.

interface BreakdownRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

export function BreakdownRow({ label, value, valueClass = "text-foreground" }: BreakdownRowProps) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
