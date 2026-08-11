import type { ExecutiveActKind } from "@/lib/constants/executiveSurface";

/**
 * Acts of Government ledger — pure merge over read-side sources (bills,
 * national executive orders, cabinet nominations/confirmations). No new
 * writes; countries missing a source simply emit fewer rows. Chip labels are
 * applied per country via `getExecutiveSurface(...).actLabels`.
 */

export interface LedgerBillInput {
  _id: string;
  title: string;
  status: string;
  enactedAt?: Date;
  failedAt?: Date;
  sentToPresidentAt?: Date;
  presidentActionDeadline?: Date;
  proposedAt: Date;
}

export interface LedgerOrderInput {
  _id: string;
  title: string;
  issuedByName: string;
  issuedAtTurn: number;
  createdAt: Date;
}

export interface LedgerNominationInput {
  _id: string;
  nomineeCharacterName: string;
  positionLabel: string;
  status: string;
  at: Date;
}

export interface LedgerCabinetMemberInput {
  _id: string;
  characterName: string;
  positionLabel: string;
  confirmedAt: Date;
}

export interface ExecutiveActInputs {
  bills: LedgerBillInput[];
  orders: LedgerOrderInput[];
  nominations: LedgerNominationInput[];
  cabinetMembers: LedgerCabinetMemberInput[];
}

export interface ExecutiveAct {
  kind: ExecutiveActKind;
  title: string;
  /** Secondary mono line (issuer, deadline, chamber detail) — optional. */
  detail?: string;
  at: Date;
  /** Real turn number when the source records one (executive orders). */
  turn?: number;
  /** Deep-link target id (bill id, order id …). */
  refId: string;
}

const SIGNED_STATUSES = new Set(["signed", "enacted", "veto_override"]);
const VETOED_STATUSES = new Set(["vetoed", "override_failed"]);

function billAct(bill: LedgerBillInput): ExecutiveAct | null {
  if (SIGNED_STATUSES.has(bill.status)) {
    return {
      kind: "signed",
      title: bill.title,
      at: bill.enactedAt ?? bill.sentToPresidentAt ?? bill.proposedAt,
      refId: bill._id,
    };
  }
  if (VETOED_STATUSES.has(bill.status)) {
    return {
      kind: "vetoed",
      title: bill.title,
      at: bill.failedAt ?? bill.sentToPresidentAt ?? bill.proposedAt,
      refId: bill._id,
    };
  }
  if (bill.status === "enrolled" || bill.status === "cabinet_review") {
    return {
      kind: "onDesk",
      title: bill.title,
      detail: bill.presidentActionDeadline
        ? `sign by ${bill.presidentActionDeadline.toISOString().slice(0, 10)}`
        : undefined,
      at: bill.sentToPresidentAt ?? bill.proposedAt,
      refId: bill._id,
    };
  }
  return null;
}

const DEFAULT_LIMIT = 14;

export function mergeExecutiveActs(
  inputs: ExecutiveActInputs,
  limit = DEFAULT_LIMIT
): ExecutiveAct[] {
  const acts: ExecutiveAct[] = [];

  for (const bill of inputs.bills) {
    const act = billAct(bill);
    if (act) acts.push(act);
  }

  for (const order of inputs.orders) {
    acts.push({
      kind: "order",
      title: order.title,
      detail: `by ${order.issuedByName}`,
      at: order.createdAt,
      turn: order.issuedAtTurn,
      refId: order._id,
    });
  }

  for (const nomination of inputs.nominations) {
    acts.push({
      kind: "nominated",
      title: `${nomination.nomineeCharacterName} — ${nomination.positionLabel}`,
      detail: nomination.status === "active" ? "awaiting confirmation" : undefined,
      at: nomination.at,
      refId: nomination._id,
    });
  }

  for (const member of inputs.cabinetMembers) {
    acts.push({
      kind: "confirmed",
      title: `${member.characterName} — ${member.positionLabel}`,
      at: member.confirmedAt,
      refId: member._id,
    });
  }

  return acts.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
