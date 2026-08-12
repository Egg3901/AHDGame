export type DispatchTone = "warning" | "info" | "success" | "error" | "muted";

export interface DispatchStatusMeta {
  label: string;
  tone: DispatchTone;
  live: boolean;
}

/**
 * Map a bill status to its Dispatch label, tone token, and live-dot flag.
 * Covers the full app `BillStatus` vocabulary (see src/lib/db/types/legislation.ts)
 * plus the prototype's "voting" alias. Unknown statuses degrade to a muted pill.
 */
const STATUS_META: Record<string, DispatchStatusMeta> = {
  // prototype alias
  voting: { label: "Voting Open", tone: "warning", live: true },
  // live voting phases
  active: { label: "Voting Open", tone: "warning", live: true },
  active_other: { label: "2nd Chamber", tone: "warning", live: true },
  active_both: { label: "Both Chambers", tone: "warning", live: true },
  veto_override: { label: "Override Vote", tone: "warning", live: true },
  cabinet_review: { label: "Cabinet Review", tone: "warning", live: true },
  override_shugiin: { label: "Shūgiin Override", tone: "warning", live: true },
  // in-progress / awaiting
  passed_origin: { label: "Passed Chamber", tone: "info", live: false },
  enrolled: { label: "On Executive's Desk", tone: "info", live: false },
  // terminal — success
  signed: { label: "Signed into Law", tone: "success", live: false },
  // terminal — failure
  failed: { label: "Failed", tone: "error", live: false },
  vetoed: { label: "Vetoed", tone: "error", live: false },
  override_failed: { label: "Override Failed", tone: "error", live: false },
  withdrawn: { label: "Withdrawn", tone: "error", live: false },
  filibustered: { label: "Filibustered", tone: "error", live: false },
  // pre-vote
  proposed: { label: "Proposed", tone: "muted", live: false },
};

export function dispatchStatusMeta(status: string): DispatchStatusMeta {
  return STATUS_META[status] ?? { label: status, tone: "muted", live: false };
}

export function toneColor(tone: DispatchTone): string {
  switch (tone) {
    case "warning":
      return "var(--warning)";
    case "info":
      return "var(--info)";
    case "success":
      return "var(--success)";
    case "error":
      return "var(--error)";
    default:
      return "var(--muted)";
  }
}

/** Human position label for an econ/social axis value in [-3, 3]. */
export function posName(v: number, axis: "econ" | "social"): string {
  if (v === 0) return "Centrist";
  const a = Math.abs(v);
  const tier = a >= 3 ? "Very " : a >= 2 ? "" : "Moderately ";
  if (axis === "econ") return `${tier}${v < 0 ? "Left" : "Right"}`.trim();
  return `${tier}${v < 0 ? "Authoritarian" : "Libertarian"}`.trim();
}
