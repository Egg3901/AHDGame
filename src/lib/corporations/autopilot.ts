/**
 * Corporation autopilot: the owner stays CEO while the cautious NPP corp brain
 * runs the routine levers (budgets, dividends, capacity growth, divesting deep
 * losers). It never pivots, tech-picks, issues debt or attacks, so it earns a
 * steady return rather than an engaged player's. What it judges worthwhile but
 * leaves to the owner is recorded each turn as advisories.
 */
import type { Corporation } from "@/lib/db/types";
import type { CorpAutopilotAdvisory, CorpAutopilotAdvisoryKind } from "@/lib/db/types/corporation";
import { CEO_ARCHETYPE_MODIFIERS, type CeoArchetypeModifiers } from "@/lib/npp/ceoArchetype";

/**
 * Cautious archetype with an unscaled payout. Autopilot exists to make a hands-off
 * owner some money, so it pays the base dividend instead of hoarding like a
 * cautious NPP.
 */
export const AUTOPILOT_MODIFIERS: CeoArchetypeModifiers = {
  ...CEO_ARCHETYPE_MODIFIERS.cautious,
  dividendMult: 1,
};

type AutopilotCorp = Pick<
  Corporation,
  | "autopilot"
  | "ceoType"
  | "ceoVacant"
  | "caretakerCeo"
  | "countryOwnerId"
  | "isNationalized"
  | "suspended"
>;

/** True when the turn should run this player corp through the autopilot brain. */
export function isAutopilotRun(corp: AutopilotCorp): boolean {
  if (!corp.autopilot) return false;
  if (corp.suspended === true) return false;
  if (corp.ceoVacant === true || corp.caretakerCeo) return false;
  if (corp.countryOwnerId != null || corp.isNationalized) return false;
  return corp.ceoType === "character" || corp.ceoType == null;
}

export type AutopilotToggleError =
  "already-on" | "already-off" | "ceo-vacant" | "caretaker-run" | "state-owned";

/** Pure validation for the owner's on/off switch. */
export function validateAutopilotToggle(
  corp: AutopilotCorp,
  enable: boolean
): AutopilotToggleError | null {
  if (!enable) return corp.autopilot ? null : "already-off";
  if (corp.autopilot) return "already-on";
  if (corp.ceoVacant === true) return "ceo-vacant";
  if (corp.caretakerCeo || corp.ceoType === "npp") return "caretaker-run";
  if (corp.countryOwnerId != null || corp.isNationalized) return "state-owned";
  return null;
}

export interface AutopilotSignals {
  /** Most plants cannot sell what they make: moving the business would help. */
  chronicLowFill: boolean;
  /** Debt service alone exceeds gross operating income. */
  debtDominant: boolean;
  /** Corp is in uncured financial distress (nationalization clock running). */
  distressed: boolean;
  /** Name of the technology the corp can afford and would benefit from, if any. */
  affordableTech?: string | null;
}

const ADVISORY_ORDER: readonly CorpAutopilotAdvisoryKind[] = ["distress", "debt", "pivot", "tech"];

/**
 * Advisories for this turn. A continuing advisory keeps its original
 * `sinceTurn` so the owner can see how long it has been outstanding.
 */
export function deriveAutopilotAdvisories(
  signals: AutopilotSignals,
  prior: readonly CorpAutopilotAdvisory[] | undefined,
  turn: number
): CorpAutopilotAdvisory[] {
  const active = new Map<CorpAutopilotAdvisoryKind, string | undefined>();
  if (signals.distressed) active.set("distress", undefined);
  if (signals.debtDominant) active.set("debt", undefined);
  if (signals.chronicLowFill) active.set("pivot", undefined);
  if (signals.affordableTech) active.set("tech", signals.affordableTech);

  const priorByKind = new Map((prior ?? []).map((a) => [a.kind, a]));
  const out: CorpAutopilotAdvisory[] = [];
  for (const kind of ADVISORY_ORDER) {
    if (!active.has(kind)) continue;
    const subject = active.get(kind);
    const before = priorByKind.get(kind);
    out.push({
      kind,
      sinceTurn: before?.sinceTurn ?? turn,
      ...(subject ? { subject } : {}),
    });
  }
  return out;
}

/** Kinds present now that were absent last turn: what the owner should hear about. */
export function newAdvisoryKinds(
  prior: readonly CorpAutopilotAdvisory[] | undefined,
  next: readonly CorpAutopilotAdvisory[]
): CorpAutopilotAdvisoryKind[] {
  const before = new Set((prior ?? []).map((a) => a.kind));
  return next.filter((a) => !before.has(a.kind)).map((a) => a.kind);
}

/** Turns before a recurring advisory may notify the owner again (one real day). */
export const AUTOPILOT_RENOTIFY_TURNS = 24;

/**
 * Newly raised advisories worth an inbox message. Technology is listed on the
 * corporation page only: it comes and goes with cash and is never urgent. A
 * condition that flickers is throttled to one message a day per kind.
 */
export function advisoriesToNotify(
  prior: readonly CorpAutopilotAdvisory[] | undefined,
  next: readonly CorpAutopilotAdvisory[],
  notifiedTurn: Partial<Record<CorpAutopilotAdvisoryKind, number>> | undefined,
  turn: number
): CorpAutopilotAdvisory[] {
  const fresh = new Set(newAdvisoryKinds(prior, next));
  return next.filter((a) => {
    if (a.kind === "tech" || !fresh.has(a.kind)) return false;
    const last = notifiedTurn?.[a.kind];
    return last == null || turn - last >= AUTOPILOT_RENOTIFY_TURNS;
  });
}

export function advisoriesChanged(
  prior: readonly CorpAutopilotAdvisory[] | undefined,
  next: readonly CorpAutopilotAdvisory[]
): boolean {
  const a = prior ?? [];
  if (a.length !== next.length) return true;
  return a.some(
    (x, i) =>
      x.kind !== next[i].kind || x.sinceTurn !== next[i].sinceTurn || x.subject !== next[i].subject
  );
}

export interface AutopilotAdvisoryCopy {
  title: string;
  body: (subject?: string) => string;
  /** Corporation page tab where the owner acts on it. */
  tab: "financials" | "credit" | "sectors" | "tech";
  action: string;
}

/** Player-facing wording, shared by the corporation page and the inbox. */
export const AUTOPILOT_ADVISORY_COPY: Record<CorpAutopilotAdvisoryKind, AutopilotAdvisoryCopy> = {
  distress: {
    title: "Nationalization risk",
    body: () =>
      "Cash is negative or a bond has defaulted, and the government can take the corporation if it stays that way. Autopilot has cut spending but will not raise money by selling shares or bonds.",
    tab: "financials",
    action: "Open financials",
  },
  debt: {
    title: "Debt is eating the profit",
    body: () =>
      "Bond interest is larger than what the business earns. Autopilot will not refinance or buy back bonds.",
    tab: "credit",
    action: "Open bonds",
  },
  pivot: {
    title: "Plants cannot sell their output",
    body: () =>
      "Most of your plants are producing more than they can sell. Autopilot has stopped adding capacity but will not retool plants or sell sectors.",
    tab: "sectors",
    action: "Open sectors",
  },
  tech: {
    title: "Research is affordable",
    body: (subject) =>
      `You can afford ${subject ?? "a new technology"}. Autopilot does not pick research because a research lane is permanent once chosen.`,
    tab: "tech",
    action: "Open technology",
  },
};
