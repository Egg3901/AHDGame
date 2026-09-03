/**
 * A bank charter's life, as explicit stages.
 *
 * The status field on the charter says three things (active, failed, revoked)
 * and every caller used to read the rest off side fields: an amber band here,
 * an undercapitalized stamp there, a resolution stamp somewhere else. This
 * module names the stages, derives one from a charter in one place, and says
 * which lifecycle actions each stage admits. The turn passes, the resolution
 * sweep, the estate worker and the console all ask this table rather than
 * comparing status strings.
 *
 * Stages are selected by capability as much as by status: a bank that takes
 * no deposits has no household book to resolve, so its failure goes straight
 * to `resolved` once the estate is cleared, while a deposit-taker passes
 * through `resolving` while the waterfall runs.
 */

import type { BankCharter, BankCharterStatus, BankCharterType } from "@/lib/db/types/bank";
import type { CapitalStanding } from "@/lib/banking/rules/balanceSheet";

export type BankLifecycleStage =
  /** No charter, or the charter was archived off the corporation. */
  | "unchartered"
  /** Active, adequately capitalized, green band. */
  | "operating"
  /** Active with a supervisory concern: amber band or a failed stress test. */
  | "watch"
  /** Active but breaching: red band or undercapitalized. Distributions barred. */
  | "impaired"
  /** Failed by the solvency pass; the estate has not yet been claimed. */
  | "failed"
  /** Resolution claimed; the deposit-book waterfall is running or has crashed mid-way. */
  | "resolving"
  /** The waterfall settled: depositors and creditors are paid what they get. */
  | "resolved"
  /** Voluntarily or supervisorily revoked; the book was returned on the way out. */
  | "revoked";

export const LIFECYCLE_STAGES: readonly BankLifecycleStage[] = [
  "unchartered",
  "operating",
  "watch",
  "impaired",
  "failed",
  "resolving",
  "resolved",
  "revoked",
];

/** What a caller wants to do to (or with) a charter. */
export type LifecycleAction =
  /** The banking turn services deposits, interest and the loan books. */
  | "service"
  /** The solvency pass evaluates confidence and the failure test. */
  | "evaluate"
  /** Players deposit, withdraw or point savings at the bank. */
  | "takeDeposits"
  /** Named loans, interbank lending and other new exposure. */
  | "originate"
  /** Draw on central bank facilities. */
  | "borrowFromCentralBank"
  /** Pay surplus up to the parent. */
  | "distribute"
  /** Change charter type. */
  | "switchType"
  /** Return the book and hand the charter back. */
  | "revoke"
  /** Claim the estate and run the failure waterfall. */
  | "claimResolution"
  /** Finish a waterfall whose money moved but whose projections did not all land. */
  | "recoverResolution"
  /** The dead-bank worker winds down the loan book of a settled estate. */
  | "windDownEstate"
  /** Charter anew (the corporation may apply again). */
  | "charter";

export const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  "service",
  "evaluate",
  "takeDeposits",
  "originate",
  "borrowFromCentralBank",
  "distribute",
  "switchType",
  "revoke",
  "claimResolution",
  "recoverResolution",
  "windDownEstate",
  "charter",
];

export type LifecycleCharter = Pick<
  BankCharter,
  | "type"
  | "status"
  | "warningBand"
  | "capitalStanding"
  | "undercapitalizedSinceTurn"
  | "depositorsResolvedTurn"
  | "resolutionClaimedTurn"
  | "failedTurn"
  | "revokedTurn"
>;

const STRESSED: readonly CapitalStanding[] = ["stressed"];
const BREACHING: readonly CapitalStanding[] = ["undercapitalized"];

/**
 * One derivation for the whole codebase. A charter's stage is read from its
 * status first, then from the supervisory stamps the passes maintain. It never
 * consults balances: the passes that move a bank between `operating`, `watch`
 * and `impaired` do the arithmetic and write the stamps; this reads them.
 */
export function lifecycleStage(charter: LifecycleCharter | null | undefined): BankLifecycleStage {
  if (!charter) return "unchartered";
  const status: BankCharterStatus = charter.status;
  if (status === "revoked") return "revoked";
  if (status === "failed") {
    if (typeof charter.depositorsResolvedTurn === "number") return "resolved";
    if (typeof charter.resolutionClaimedTurn === "number") return "resolving";
    return "failed";
  }
  if (charter.warningBand === "red") return "impaired";
  if (charter.capitalStanding && BREACHING.includes(charter.capitalStanding)) return "impaired";
  if (typeof charter.undercapitalizedSinceTurn === "number") return "impaired";
  if (charter.warningBand === "amber") return "watch";
  if (charter.capitalStanding && STRESSED.includes(charter.capitalStanding)) return "watch";
  return "operating";
}

/**
 * The stage table. Read it as "in stage S, action A is allowed".
 *
 * `impaired` still services and evaluates (a breaching bank must keep paying
 * interest and be tested next turn), still takes deposits (a run is the
 * depositors' decision, not the supervisor's), and may still borrow from the
 * central bank (that is what the window is for). It may not originate new
 * exposure, distribute, or switch type. A `failed` estate does nothing but
 * wait to be claimed; `resolving` admits only recovery; `resolved` and
 * `revoked` admit the estate worker and a fresh charter.
 */
const STAGE_TABLE: Record<BankLifecycleStage, readonly LifecycleAction[]> = {
  unchartered: ["charter"],
  operating: [
    "service",
    "evaluate",
    "takeDeposits",
    "originate",
    "borrowFromCentralBank",
    "distribute",
    "switchType",
    "revoke",
  ],
  watch: [
    "service",
    "evaluate",
    "takeDeposits",
    "originate",
    "borrowFromCentralBank",
    "switchType",
    "revoke",
  ],
  impaired: ["service", "evaluate", "takeDeposits", "borrowFromCentralBank", "revoke"],
  failed: ["claimResolution"],
  resolving: ["recoverResolution"],
  resolved: ["windDownEstate", "charter"],
  revoked: ["windDownEstate", "charter"],
};

export function stageAllows(stage: BankLifecycleStage, action: LifecycleAction): boolean {
  return STAGE_TABLE[stage].includes(action);
}

export function stageActions(stage: BankLifecycleStage): readonly LifecycleAction[] {
  return STAGE_TABLE[stage];
}

/** Every stage in which `action` is allowed; the query-side view of the table. */
export function stagesAllowing(action: LifecycleAction): BankLifecycleStage[] {
  return LIFECYCLE_STAGES.filter((stage) => stageAllows(stage, action));
}

export type LifecycleRefusal =
  { code: "no_charter" } | { code: "stage"; stage: BankLifecycleStage; action: LifecycleAction };

/**
 * Refuse or allow an action for a charter, with a message a player can read.
 * Returns null when allowed.
 */
export function lifecycleRefusal(
  charter: LifecycleCharter | null | undefined,
  action: LifecycleAction
): { refusal: LifecycleRefusal; message: string } | null {
  const stage = lifecycleStage(charter);
  if (stageAllows(stage, action)) return null;
  if (stage === "unchartered") {
    return { refusal: { code: "no_charter" }, message: "This corporation holds no bank charter." };
  }
  return {
    refusal: { code: "stage", stage, action },
    message: lifecycleMessage(stage, action, charter?.type),
  };
}

const STAGE_LABEL: Record<BankLifecycleStage, string> = {
  unchartered: "unchartered",
  operating: "operating",
  watch: "under supervisory watch",
  impaired: "impaired",
  failed: "failed and awaiting resolution",
  resolving: "in resolution",
  resolved: "resolved",
  revoked: "revoked",
};

const ACTION_LABEL: Record<LifecycleAction, string> = {
  service: "service its books",
  evaluate: "be evaluated",
  takeDeposits: "take deposits",
  originate: "take on new exposure",
  borrowFromCentralBank: "borrow from the central bank",
  distribute: "pay capital up to its parent",
  switchType: "change charter type",
  revoke: "hand its charter back",
  claimResolution: "enter resolution",
  recoverResolution: "finish an unfinished resolution",
  windDownEstate: "have its estate wound down",
  charter: "be chartered",
};

export function lifecycleMessage(
  stage: BankLifecycleStage,
  action: LifecycleAction,
  type?: BankCharterType
): string {
  const noun = type ? `${type} bank` : "bank";
  if (stage === "impaired" && (action === "originate" || action === "distribute")) {
    return `An impaired ${noun} may not ${ACTION_LABEL[action]} until it is back above its capital and reserve floors.`;
  }
  if (stage === "impaired" && action === "switchType") {
    return `An impaired ${noun} may not change charter type. Restore its capital first.`;
  }
  if (stage === "resolving") {
    return `This ${noun} is in resolution. Nothing moves until the waterfall settles.`;
  }
  return `A ${noun} that is ${STAGE_LABEL[stage]} may not ${ACTION_LABEL[action]}.`;
}

/**
 * Stage events, for the shells that move a charter along. Pure: given the
 * current stage and an event, the next stage, or null when the event is not
 * legal from here. The shells persist the stamp that makes `lifecycleStage`
 * read the new stage; this is the check they run before doing so.
 */
export type LifecycleEvent =
  | "chartered"
  | "warned"
  | "breached"
  | "recovered"
  | "failed"
  | "resolution_claimed"
  | "resolution_settled"
  | "revoked"
  | "archived";

const TRANSITIONS: Record<
  BankLifecycleStage,
  Partial<Record<LifecycleEvent, BankLifecycleStage>>
> = {
  unchartered: { chartered: "operating" },
  operating: { warned: "watch", breached: "impaired", failed: "failed", revoked: "revoked" },
  watch: {
    recovered: "operating",
    breached: "impaired",
    failed: "failed",
    revoked: "revoked",
  },
  impaired: { recovered: "operating", warned: "watch", failed: "failed", revoked: "revoked" },
  failed: { resolution_claimed: "resolving" },
  resolving: { resolution_settled: "resolved" },
  resolved: { archived: "unchartered" },
  revoked: { archived: "unchartered" },
};

export function nextStage(
  stage: BankLifecycleStage,
  event: LifecycleEvent
): BankLifecycleStage | null {
  return TRANSITIONS[stage][event] ?? null;
}
