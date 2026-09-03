import { describe, expect, it } from "vitest";
import {
  BANKING_AUDIT_EVENT_KINDS,
  assertNoPrivateData,
  bankingAuditAction,
  bankingAuditCategory,
  isStaleRejection,
  privateDataKeys,
  toAuditEnvelope,
  type BankingAuditEvent,
} from "./auditEvents";

const BASE: BankingAuditEvent = {
  kind: "loan.paid",
  correlationId: "turn:120:bankingTurn",
  command: "bank.loan.service",
  turn: 120,
  actorClass: "system",
  outcome: "ok",
  currency: "USD",
  bankId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  subjectType: "loan",
  subjectId: "bbbbbbbbbbbbbbbbbbbbbbbb",
  statusBefore: "arrears",
  statusAfter: "current",
  settlementId: "loan-service:bbbbbbbbbbbbbbbbbbbbbbbb:120",
  amount: 104.8,
};

describe("banking audit event contract", () => {
  it("lists every kind once and files each under money or governance", () => {
    expect(new Set(BANKING_AUDIT_EVENT_KINDS).size).toBe(BANKING_AUDIT_EVENT_KINDS.length);
    for (const kind of BANKING_AUDIT_EVENT_KINDS) {
      const category = bankingAuditCategory(kind);
      expect(category).toBe(
        kind.startsWith("meeting.") || kind.startsWith("policy.") ? "governance" : "money"
      );
      expect(bankingAuditAction(kind)).toBe(`bank.${kind}`);
    }
  });

  it("projects a turn event onto the spine with correlation, statuses and settlement", () => {
    const envelope = toAuditEnvelope(BASE);
    expect(envelope).toEqual({
      source: "turn",
      action: "bank.loan.paid",
      category: "money",
      turn: 120,
      traceId: "turn:120:bankingTurn",
      actor: { kind: "system" },
      subject: { type: "loan", id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
      outcome: "ok",
      amount: 104.8,
      currencyCode: "USD",
      refs: { corporationId: "aaaaaaaaaaaaaaaaaaaaaaaa" },
      meta: {
        kind: "loan.paid",
        command: "bank.loan.service",
        bankId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        statusBefore: "arrears",
        statusAfter: "current",
        settlementId: "loan-service:bbbbbbbbbbbbbbbbbbbbbbbb:120",
      },
    });
  });

  it("derives the source from the correlation id and actor class", () => {
    expect(toAuditEnvelope({ ...BASE, correlationId: "req-1", actorClass: "player" }).source).toBe(
      "api"
    );
    expect(toAuditEnvelope({ ...BASE, correlationId: "req-1", actorClass: "admin" }).source).toBe(
      "admin"
    );
    expect(toAuditEnvelope({ ...BASE, correlationId: "req-1", actorClass: "system" }).source).toBe(
      "system"
    );
  });

  it("falls back to the bank as subject when the event names no subject", () => {
    const envelope = toAuditEnvelope({
      kind: "charter.issued",
      correlationId: "req-2",
      command: "bank.charter.issue",
      turn: 5,
      actorClass: "player",
      outcome: "ok",
      bankId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(envelope.subject).toEqual({ type: "bank", id: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(envelope.refs).toEqual({ corporationId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("carries a rejection reason and no amount when nothing moved", () => {
    const envelope = toAuditEnvelope({
      ...BASE,
      outcome: "rejected",
      reason: "Principal exceeds lendable headroom (max 100)",
      amount: undefined,
      settlementId: undefined,
    });
    expect(envelope.outcome).toBe("rejected");
    expect(envelope.reason).toContain("headroom");
    expect(envelope).not.toHaveProperty("amount");
    expect(envelope.meta).not.toHaveProperty("settlementId");
  });

  it("refuses private data keys in meta", () => {
    expect(privateDataKeys({ ratePercent: 4, borrowerName: "x" })).toEqual(["borrowerName"]);
    expect(privateDataKeys({ ipMasked: "1.2.x.x" })).toEqual(["ipMasked"]);
    expect(privateDataKeys({ termTurns: 48, lendingProfile: "balanced" })).toEqual([]);
    expect(() => assertNoPrivateData({ ...BASE, meta: { email: "a@b" } })).toThrow(/private data/);
    expect(() => toAuditEnvelope({ ...BASE, meta: { username: "a" } })).toThrow(/username/);
  });

  it("classifies race losses as stale and everything else as rejected", () => {
    expect(isStaleRejection("The bank's reserves moved while that was in flight. Try again.")).toBe(
      true
    );
    expect(isStaleRejection("Loan is not pending")).toBe(true);
    expect(isStaleRejection("You have already voted in this meeting")).toBe(true);
    expect(isStaleRejection("Principal exceeds the bank's cash reserves (max 5)")).toBe(false);
    expect(isStaleRejection(undefined)).toBe(false);
  });
});
