export const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  active: "Voting Open",
  passed_origin: "Passed Chamber",
  active_other: "Second Chamber Vote",
  enrolled: "Awaiting President",
  signed: "Signed Into Law",
  vetoed: "Vetoed",
  veto_override: "Override Vote Open",
  cabinet_review: "Cabinet Review",
  override_shugiin: "Shugiin Override Vote",
  override_failed: "Veto Sustained",
  failed: "Failed",
  withdrawn: "Withdrawn",
};

export const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  active: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  passed_origin: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  active_other: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  enrolled: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  cabinet_review: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  override_shugiin: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  signed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  vetoed: "bg-error/20 text-error border-error/30",
  failed: "bg-error/20 text-error border-error/30",
  withdrawn: "bg-card-elevated text-muted border-card-border",
};

export function chamberLabel(c: string): string {
  if (c === "house") return "House";
  if (c === "senate") return "Senate";
  if (c === "commons") return "Commons";
  if (c === "lords") return "Lords";
  if (c === "cabinet") return "Cabinet";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export const TIMELINE_STEPS = [
  { key: "proposed", label: "Proposed", dateField: "proposedAt" },
  { key: "active", label: "Origin Chamber Vote", dateField: "votingStartedAt" },
  { key: "passed_origin", label: "Passed Origin", dateField: "passedOriginAt" },
  { key: "active_other", label: "Second Chamber Vote", dateField: "otherChamberVotingStartedAt" },
  { key: "enrolled", label: "Sent to President", dateField: "sentToPresidentAt" },
  { key: "signed", label: "Signed / Enacted", dateField: "enactedAt" },
];

/**
 * Single-chamber legislatures (UK Commons, DE Bundestag, CN NPC, IE Dáil) build
 * their timeline at render time from the country's lower-chamber name — see
 * TimelineStepper's `unicameralSteps`. No per-country constant needed.
 *
 * JP bills pass both chambers of the Diet and enact immediately — there is no
 * executive veto step, so the "Sent to President" milestone is omitted.
 */
export const JP_TIMELINE_STEPS = [
  { key: "proposed", label: "Proposed", dateField: "proposedAt" },
  { key: "active", label: "Origin Chamber Vote", dateField: "votingStartedAt" },
  { key: "passed_origin", label: "Passed Origin", dateField: "passedOriginAt" },
  { key: "active_other", label: "Second Chamber Vote", dateField: "otherChamberVotingStartedAt" },
  { key: "signed", label: "Signed / Enacted", dateField: "enactedAt" },
];

export const JP_CABINET_TIMELINE_STEPS = [
  { key: "proposed", label: "Proposed", dateField: "proposedAt" },
  { key: "cabinet_review", label: "Cabinet Review", dateField: "votingStartedAt" },
  { key: "active", label: "Shugiin Vote", dateField: "votingStartedAt" },
  { key: "active_other", label: "Sangiin Vote", dateField: "otherChamberVotingStartedAt" },
  { key: "signed", label: "Signed / Enacted", dateField: "enactedAt" },
];

export const TERMINAL_STATUSES = ["failed", "withdrawn", "vetoed", "override_failed"];
