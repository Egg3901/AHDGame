import { STATUS_LABELS, STATUS_COLORS } from "../billHelpers";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLORS[status] ?? "bg-card-elevated text-muted border-card-border"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
