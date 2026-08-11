import type { ExtractionContractStatus } from "./types";

const STATUS_STYLES: Record<ExtractionContractStatus, string> = {
  offered: "bg-primary/15 text-primary border-primary/30",
  active: "bg-success/15 text-success border-success/30",
  declined: "bg-muted/15 text-muted border-card-border",
  expired: "bg-muted/15 text-muted border-card-border",
  defaulted: "bg-error/15 text-error border-error/30",
};

const STATUS_LABELS: Record<ExtractionContractStatus, string> = {
  offered: "Offered",
  active: "Active",
  declined: "Declined",
  expired: "Expired",
  defaulted: "Defaulted",
};

export function ContractStatusBadge({ status }: { status: ExtractionContractStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
