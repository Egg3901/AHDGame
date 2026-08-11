import type { ReferendumStatus } from "@/lib/db/types/referendum";

export type CampaignStatus = ReferendumStatus;

const META: Record<CampaignStatus, { label: string; tone: "yes" | "no" | "amber" | "muted" }> = {
  requested: { label: "Awaiting PM", tone: "amber" },
  granted: { label: "Opening", tone: "amber" },
  campaigning: { label: "Live", tone: "amber" },
  polling: { label: "Counting", tone: "amber" },
  actuating: { label: "Converting", tone: "amber" },
  completed: { label: "Passed", tone: "yes" },
  settled: { label: "Failed", tone: "no" },
  declined: { label: "Declined", tone: "no" },
  cancelled: { label: "Cancelled", tone: "no" },
};

export function statusMeta(status: CampaignStatus) {
  return META[status] ?? { label: status, tone: "muted" as const };
}

const TONE: Record<"yes" | "no" | "amber" | "muted", string> = {
  yes: "text-[var(--ref-yes)] bg-[color-mix(in_srgb,var(--ref-yes)_14%,transparent)]",
  no: "text-[var(--ref-no)] bg-[color-mix(in_srgb,var(--ref-no)_14%,transparent)]",
  amber: "text-[var(--ref-amber)] bg-[color-mix(in_srgb,var(--ref-amber)_14%,transparent)]",
  muted: "text-muted bg-card-elevated",
};

/** Status → coloured pill for the campaigns panel (hub cards + detail masthead). */
export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  const m = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${TONE[m.tone]}`}
    >
      {m.label}
    </span>
  );
}
