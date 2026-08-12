import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types";
import type { BillVoteSnapshot } from "@/lib/db/types/voteSnapshot";

export interface VoteTotals {
  for: number;
  against: number;
  abstain: number;
}

/** Pass rule applied to a chamber vote's scoped totals. */
export type PassRule = "simpleMajority" | "twoThirdsCast" | "filibusterCloture";

/** What happens when a chamberVote rejects a bill. */
export type OnReject = "fail" | "sendToOverride" | "advance";

/** Minimal bill shape a stage needs to resolve its office type. */
export interface StageBillContext {
  currentChamber: string;
  countryId?: CountryId;
  /**
   * The world's reset preset. Legislature SHAPE is preset-dependent — Germany's 1953
   * override flips `bicameral` to true over an appointed Bundesrat, and TR/ES flip
   * `upperElectionSystem` — so a stage that resolves its config without this gets the
   * wrong chamber count with no error.
   */
  preset?: string;
}

export interface ChamberVoteStage {
  kind: "chamberVote";
  /** Bill status this stage owns (e.g. "active", "active_other"). */
  status: string;
  /** Vote map this stage tallies. */
  voteField: "votes" | "otherChamberVotes";
  /** Resolves the office type to scope votes against, from the bill's chamber. */
  officeTypeFor: (bill: StageBillContext) => string;
  passRule: PassRule;
  onReject: OnReject;
  /** Next status on pass (the following stage's status, or a terminal status). */
  onPassStatus: string;
  votingDurationHours: number;
  /**
   * When true, a passing bill only enters `onPassStatus` (an executiveAction
   * stage) if `billRequiresExecutiveAction(bill)`; otherwise it is signed +
   * enacted directly. Reproduces US phase E (intl-org bills skip the President).
   */
  execActionCheckOnPass?: boolean;
  /**
   * The `currentChamber` to set when a bill ENTERS this stage. Defaults to
   * `otherChamber(bill.originChamber)` (US bicameral). JP uses static values
   * (Sangiin, Shūgiin). Only consulted when a bill advances INTO this stage.
   */
  chamberOnEnter?: (bill: StageBillContext) => string;
  /**
   * Bill-dependent reject routing (overrides `onReject` when present). Returns
   * `"fail"` (→ failed) or a target status to enter. Reproduces JP Sangiin:
   * sangiin-origin bills fail, Shūgiin/cabinet-origin route to `override_shugiin`.
   */
  onRejectFn?: (
    bill: StageBillContext & { originChamber?: string }
  ) => "fail" | { toStatus: string };
  /** Also `$unset whippedFromVote` when a bill ENTERS this stage (fresh vote phase). */
  clearWhippedFrom?: boolean;
  /** Bespoke side effect run when a bill ENTERS this stage (JP: delete Shūgiin billWhips). */
  onEnterHook?: (db: Db, bill: StageBillContext & { _id: unknown }) => Promise<void>;
}

export interface ExecutiveActionStage {
  kind: "executiveAction";
  status: string; // e.g. "enrolled"
  execKind: "presidentVeto" | "assent";
  officeType: string; // "president", or "" for pure assent
  windowHours: number; // 0 = auto-enact immediately (no window)
  onTimeout: "sign" | "enact";
}

export interface OverrideStage {
  kind: "override";
  status: string; // e.g. "veto_override"
  threshold: "twoThirdsSeats" | "twoThirdsCast";
  chambers: string[]; // officeTypes that must each clear the threshold
  votingDurationHours: number;
}

/**
 * Both chambers voting AT ONCE, each into its own tally, passing only if every chamber
 * clears the bar.
 *
 * Modelled on `OverrideStage`, which is already a concurrent bicameral vote with
 * `requireAll` semantics (`stage.chambers.every(...)`). Two things stop it being reused
 * directly: its tally is keyed on hardcoded `house`/`senate` literals, so it is US-only;
 * and it uses one vote map, which forces a display snapshot. Two maps mean the
 * per-chamber counters and snapshots already exist.
 */
export interface ConcurrentVoteStage {
  kind: "concurrentVote";
  /** Bill status this stage owns — "active_both". */
  status: string;
  /**
   * Office types voting simultaneously; one entry for a unicameral country.
   *
   * MUST be `getJointSittingOfficeTypes`, NOT `legislature.bicameral`. Germany's 1953
   * override sets `bicameral: true` over an appointed Bundesrat with no
   * `upperElectionSystem`, so the bicameral reading yields two chambers, the upper tally
   * is structurally empty, and `requireAll` fails every German bill.
   */
  chambersFor: (bill: StageBillContext) => string[];
  /** Vote map per office type: lower → "votes", upper → "otherChamberVotes". */
  voteFieldFor: (bill: StageBillContext, officeType: string) => "votes" | "otherChamberVotes";
  passRule: PassRule;
  /** Every listed chamber must clear the bar — OverrideStage's `.every` semantics. */
  requireAll: true;
  onPassStatus: string;
  votingDurationHours: number;
  execActionCheckOnPass?: boolean;
}

export type BillStage =
  ChamberVoteStage | ExecutiveActionStage | OverrideStage | ConcurrentVoteStage;

/** Per-country sponsor notifier; `status` is the transition the engine applied. */
export type SponsorNotifier = (db: Db, bill: Bill, status: Bill["status"]) => Promise<void>;

export interface BillLifecycleConfig {
  country: CountryId;
  level: "national" | "regional";
  /** Ordered phase graph. Each stage owns a distinct bill status. */
  stages: BillStage[];
  /**
   * Origin chambers this config owns (e.g. ["house","senate","joint"] for US).
   * Scopes the proposed-activation and expired-vote queries so one country's
   * engine never touches another's bills.
   */
  originChambers: string[];
  flags?: { jointSkipsSecondChamber?: boolean };
  /**
   * Run Phase-A (activate lingering `proposed` bills into the first chamber).
   * US does this as an edge-case safety net; UK/others never had it.
   */
  activateProposed?: boolean;
  /** Skip the whole phase if this country's government formation is `pending`. */
  skipWhenGovPending?: boolean;
  /** Per-country sponsor notification override; defaults to the US notifier. */
  notifySponsor?: SponsorNotifier;
  /**
   * UK Lords revision flavor: after Commons passage, small chance to hold the
   * bill in `enrolled` for 1–2 turns (wire only — no Lords seats/votes) before
   * Royal Assent via the existing executive timeout path.
   */
  lordsRevisionFlavor?: {
    chance: number;
    delayTurnsMin: number;
    delayTurnsMax: number;
  };
}

export interface PhaseVoteResult {
  totals: VoteTotals;
  snapshot: BillVoteSnapshot;
}
