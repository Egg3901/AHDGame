export type TurnActivityId =
  "elections" | "economy" | "military" | "policy" | "parties" | "people" | "preparing" | "updating";

export interface TurnActivity {
  id: TurnActivityId;
  label: string | null;
}

const FALLBACK_ACTIVITY: Record<Exclude<TurnActivityId, "updating">, string> = {
  elections: "Counting votes and resolving elections",
  economy: "Updating markets and the economy",
  military: "Resolving conflicts and military affairs",
  policy: "Advancing laws and public policy",
  parties: "Updating parties and public opinion",
  people: "Updating people and public services",
  preparing: "Preparing the next turn",
};

/**
 * Bottom-anchored slot: horizontally centered on small screens, docked right
 * on desktop. Not a viewport-center modal, and not the footer StatusBar.
 */
export const TURN_PROGRESS_SLOT_CLASS = [
  "pointer-events-none fixed inset-x-0 z-40 flex justify-center",
  "bottom-[calc(3.25rem+env(safe-area-inset-bottom))]",
  "pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]",
  "sm:inset-x-auto sm:left-auto sm:right-5 sm:justify-end sm:px-0",
].join(" ");

export const TURN_PROGRESS_CARD_CLASS = [
  "pointer-events-auto w-full max-w-[20rem] overflow-hidden rounded-lg",
  "border border-card-border/70 bg-card/95 shadow-lg backdrop-blur-md",
  "motion-reduce:shadow-none",
].join(" ");

export function classifyTurnActivity(phase: string | null, label: string | null): TurnActivity {
  const key = (phase ?? "").toLowerCase();
  if (/elect|vote|primary|referendum/.test(key)) return { id: "elections", label: null };
  if (/market|corp|bank|forex|econom|trade|production|wage|tax/.test(key)) {
    return { id: "economy", label: null };
  }
  if (/war|military|conflict|defen|army|navy|nuclear/.test(key)) {
    return { id: "military", label: null };
  }
  if (/bill|legislat|policy|law|court|judic/.test(key)) return { id: "policy", label: null };
  if (/party|approval|campaign|opinion|ideolog/.test(key)) return { id: "parties", label: null };
  if (/population|demograph|migration|health|education/.test(key)) {
    return { id: "people", label: null };
  }
  if (!label) return { id: "preparing", label: null };
  return { id: "updating", label: label.toLowerCase() };
}

export function describeTurnPhase(phase: string | null, label: string | null): string {
  const activity = classifyTurnActivity(phase, label);
  if (activity.id === "updating") return `Updating ${activity.label}`;
  return FALLBACK_ACTIVITY[activity.id];
}
