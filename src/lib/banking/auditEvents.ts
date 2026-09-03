/**
 * Shell for the banking audit-event contract: takes a plain event, projects it
 * onto the audit spine, and keeps the product counters in step.
 *
 * The correlation id comes from the ambient audit context when the caller
 * does not supply one (a request's trace id, or `turn:<n>:<phase>` inside a
 * turn), so every event written for one request or phase groups together.
 */

import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getAuditRequestContext } from "@/lib/observability/context";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  isStaleRejection,
  toAuditEnvelope,
  type BankingActorClass,
  type BankingAuditEvent,
} from "@/lib/banking/rules/auditEvents";
import { countBankingEvent } from "@/lib/banking/telemetry";

export type { BankingAuditEvent } from "@/lib/banking/rules/auditEvents";

/** Everything the caller must know; the rest is resolved from context. */
export type BankingAuditEventInput = Omit<BankingAuditEvent, "correlationId" | "actorClass"> &
  Partial<Pick<BankingAuditEvent, "correlationId" | "actorClass">>;

function actorClassFromContext(): BankingActorClass {
  const kind = getAuditRequestContext()?.actor?.kind;
  return kind ?? "system";
}

/**
 * Emit one banking audit event. Fire-and-forget: a bad event is reported to
 * Sentry and dropped, never thrown into game logic. Passing `db` also keeps
 * the rejected/stale command counters current for the event's turn.
 */
export function emitBankingAuditEvent(input: BankingAuditEventInput, db?: Db): void {
  try {
    const context = getAuditRequestContext();
    const event: BankingAuditEvent = {
      ...input,
      correlationId: input.correlationId ?? context?.traceId ?? `banking:${input.turn}`,
      actorClass: input.actorClass ?? actorClassFromContext(),
    };
    const envelope = toAuditEnvelope(event);
    const record: ActionAuditInput = {
      source: envelope.source,
      action: envelope.action,
      category: envelope.category,
      turn: envelope.turn,
      traceId: envelope.traceId,
      actor: envelope.actor,
      subject: envelope.subject,
      outcome: envelope.outcome,
      ...(envelope.reason ? { reason: envelope.reason } : {}),
      ...(envelope.amount !== undefined ? { amount: envelope.amount } : {}),
      ...(envelope.currencyCode ? { currencyCode: envelope.currencyCode as CurrencyCode } : {}),
      ...(envelope.refs ? { refs: envelope.refs } : {}),
      meta: envelope.meta,
    };
    recordAudit(record);

    if (db && event.outcome === "rejected") {
      countBankingEvent(
        db,
        event.turn,
        isStaleRejection(event.reason) ? "staleCommands" : "rejectedCommands"
      );
    }
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "emitBankingAuditEvent", kind: input.kind } });
  }
}
