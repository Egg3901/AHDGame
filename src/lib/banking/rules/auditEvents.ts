/**
 * The banking audit-event contract.
 *
 * Every banking state change that a player, an operator or a later
 * reconciliation might need to explain is described by one of these events.
 * The shape is fixed here, once, so a charter revocation in the turn and a
 * charter revocation from the admin route produce the same record with the
 * same fields, and a dashboard can query "everything that happened to this
 * loan" without knowing which module wrote each row.
 *
 * What is deliberately NOT in an event: names, emails, IPs, or any other
 * player-identifying data. Subjects are opaque ids; the actor is a class
 * (player, npp, system, admin), not a person. `assertNoPrivateData` refuses an
 * event that tries to smuggle any of that in through `meta`.
 */

export type BankingAuditEventKind =
  | "charter.issued"
  | "charter.revoked"
  | "charter.switched"
  | "account.holder_changed"
  | "account.deposited"
  | "account.withdrawn"
  | "account.interest_paid"
  | "loan.originated"
  | "loan.approved"
  | "loan.rejected"
  | "loan.disbursed"
  | "loan.paid"
  | "loan.delinquent"
  | "loan.defaulted"
  | "bank.failed"
  | "bank.resolved"
  | "meeting.transitioned"
  | "meeting.voted"
  | "policy.rate_changed";

export const BANKING_AUDIT_EVENT_KINDS: readonly BankingAuditEventKind[] = [
  "charter.issued",
  "charter.revoked",
  "charter.switched",
  "account.holder_changed",
  "account.deposited",
  "account.withdrawn",
  "account.interest_paid",
  "loan.originated",
  "loan.approved",
  "loan.rejected",
  "loan.disbursed",
  "loan.paid",
  "loan.delinquent",
  "loan.defaulted",
  "bank.failed",
  "bank.resolved",
  "meeting.transitioned",
  "meeting.voted",
  "policy.rate_changed",
];

export type BankingActorClass = "player" | "npp" | "system" | "admin";

export type BankingAuditOutcome = "ok" | "rejected" | "error";

/** Scalar-only metadata: no nested documents, so nothing large or personal fits. */
export type BankingAuditMeta = Readonly<Record<string, string | number | boolean | null>>;

export interface BankingAuditEvent {
  kind: BankingAuditEventKind;
  /** Groups every event written for one request or turn phase. */
  correlationId: string;
  /** The command or turn stage that produced the event, e.g. `bank.loan.originate`. */
  command: string;
  turn: number;
  actorClass: BankingActorClass;
  outcome: BankingAuditOutcome;
  currency?: string;
  /** Bank corporation id (hex) or central bank id, depending on the event. */
  bankId?: string;
  /** The thing the event is about: a loan id, an account owner id, a meeting id. */
  subjectType?: string;
  subjectId?: string;
  statusBefore?: string;
  statusAfter?: string;
  /** Idempotency key of the settlement that moved the money, when one did. */
  settlementId?: string;
  /** Aggregate financial effect in `currency`. Sign follows the subject's view. */
  amount?: number;
  reason?: string;
  meta?: BankingAuditMeta;
}

/** Audit spine category each event family lands in. */
export function bankingAuditCategory(kind: BankingAuditEventKind): "money" | "governance" {
  return kind.startsWith("meeting.") || kind.startsWith("policy.") ? "governance" : "money";
}

/** Namespaced action verb on the audit spine, e.g. `bank.loan.paid`. */
export function bankingAuditAction(kind: BankingAuditEventKind): string {
  return `bank.${kind}`;
}

const PRIVATE_KEY_TOKENS: ReadonlySet<string> = new Set([
  "name",
  "email",
  "ip",
  "address",
  "phone",
  "username",
  "fingerprint",
  "password",
  "token",
]);

/** `borrowerName` -> ["borrower", "name"]; `ip_masked` -> ["ip", "masked"]. */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

/**
 * Keys that would carry player-identifying data are refused outright. The
 * check is over key names rather than values because a value can be anything
 * and a key is a declaration of intent.
 */
export function privateDataKeys(meta: BankingAuditMeta | undefined): string[] {
  if (!meta) return [];
  return Object.keys(meta).filter((key) =>
    keyTokens(key).some((token) => PRIVATE_KEY_TOKENS.has(token))
  );
}

export function assertNoPrivateData(event: BankingAuditEvent): void {
  const offending = privateDataKeys(event.meta);
  if (offending.length > 0) {
    throw new Error(
      `banking audit event ${event.kind} carries private data keys: ${offending.join(", ")}`
    );
  }
}

/**
 * The envelope the audit spine stores. Kept as plain data so the shell can
 * hand it to `recordAudit` and a simulation host can collect it in memory.
 */
export interface BankingAuditEnvelope {
  source: "api" | "turn" | "admin" | "system";
  action: string;
  category: "money" | "governance";
  turn: number;
  traceId: string;
  actor: { kind: BankingActorClass };
  subject: { type: string; id?: string };
  outcome: BankingAuditOutcome;
  reason?: string;
  amount?: number;
  currencyCode?: string;
  refs?: { corporationId?: string };
  meta: Record<string, string | number | boolean | null>;
}

function sourceFor(
  correlationId: string,
  actorClass: BankingActorClass
): BankingAuditEnvelope["source"] {
  if (correlationId.startsWith("turn:")) return "turn";
  if (actorClass === "admin") return "admin";
  if (actorClass === "system") return "system";
  return "api";
}

/** Project a banking event onto the audit spine's envelope. */
export function toAuditEnvelope(event: BankingAuditEvent): BankingAuditEnvelope {
  assertNoPrivateData(event);
  const meta: Record<string, string | number | boolean | null> = {
    kind: event.kind,
    command: event.command,
    ...(event.bankId ? { bankId: event.bankId } : {}),
    ...(event.statusBefore !== undefined ? { statusBefore: event.statusBefore } : {}),
    ...(event.statusAfter !== undefined ? { statusAfter: event.statusAfter } : {}),
    ...(event.settlementId ? { settlementId: event.settlementId } : {}),
    ...(event.meta ?? {}),
  };
  return {
    source: sourceFor(event.correlationId, event.actorClass),
    action: bankingAuditAction(event.kind),
    category: bankingAuditCategory(event.kind),
    turn: event.turn,
    traceId: event.correlationId,
    actor: { kind: event.actorClass },
    subject: {
      type: event.subjectType ?? (event.bankId ? "bank" : "banking"),
      id: event.subjectId ?? event.bankId,
    },
    outcome: event.outcome,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.amount !== undefined ? { amount: event.amount } : {}),
    ...(event.currency ? { currencyCode: event.currency } : {}),
    ...(event.bankId ? { refs: { corporationId: event.bankId } } : {}),
    meta,
  };
}

/**
 * Whether a rejection reason describes a command that lost a race with
 * another writer rather than one that was wrong to begin with. Counted
 * separately because a rising stale rate is a concurrency problem and a
 * rising rejected rate is a UI or rules problem.
 */
export function isStaleRejection(reason: string | undefined): boolean {
  if (!reason) return false;
  return /while (that was|it was|the switch was) in flight|moved while|changed while|no longer (active|pending|eligible)|already (active|voted|been)|not pending/i.test(
    reason
  );
}
