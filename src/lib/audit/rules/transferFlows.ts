import type { AuditAnomalyFinding, AuditAnomalyType } from "@/lib/db/types/auditAnomalies";

export type AnomalyActorKind = "player" | "npp" | "system" | "admin";

export interface AnomalyAuditRow {
  id: string;
  traceId: string;
  seq?: number;
  ts: Date;
  turn: number;
  action: string;
  category: string;
  actorKey: string | null;
  actorKind?: AnomalyActorKind;
  subjectType?: string;
  subjectId?: string;
  counterpartyType?: string;
  counterpartyId?: string;
  amount?: number;
  agreementId?: string;
  pricePerShare?: number;
  orderSide?: "buy" | "sell";
}

export interface TransferDetectorResult {
  flaggedIds: Set<string>;
  finding: AuditAnomalyFinding | null;
}

export interface TransferFlowConfig {
  fanInThreshold: number;
  fanOutThreshold: number;
}

const PAIR_WINDOW_MS = 5_000;

/** Routine settlement verbs are expected to be hub-shaped or mirrored. */
export const SYSTEM_SETTLEMENT_ACTIONS: ReadonlySet<string> = new Set([
  "bond.coupon",
  "bond.maturity",
  "gov.coupon_payment",
  "gov.bond_maturity_payment",
  "corp.tax_paid",
  "gov.tax_revenue",
  "party.dues_received",
  "party.caucus_tax",
  "corp.supply_agreement",
  "corp.dividends",
  "corp.salary",
  "gov.subsidy_paid",
  "gov.grant_paid",
  "gov.budget_transfer",
  "crisis.payout",
  "crisis.levy",
  "system.world_event_payout",
]);

interface TransferFlow {
  from: string;
  to: string;
}

interface TransferEvent {
  flow: TransferFlow;
  startedAt: number;
  endedAt: number;
  lastSeq?: number;
  rows: AnomalyAuditRow[];
}

function flowOf(row: AnomalyAuditRow): TransferFlow | null {
  if (row.category !== "money" || !row.subjectId || !row.counterpartyId) return null;
  const amount = row.amount;
  if (typeof amount !== "number" || amount === 0) return null;
  const flow =
    amount < 0
      ? { from: row.subjectId, to: row.counterpartyId }
      : { from: row.counterpartyId, to: row.subjectId };
  return flow.from === flow.to ? null : flow;
}

function isActorDriven(row: AnomalyAuditRow): boolean {
  if (SYSTEM_SETTLEMENT_ACTIONS.has(row.action)) return false;
  if (row.actorKind === "system") return false;
  if (row.actorKind)
    return row.actorKind === "player" || row.actorKind === "npp" || row.actorKind === "admin";
  return row.actorKey !== null;
}

function sameFlow(left: TransferFlow, right: TransferFlow): boolean {
  return left.from === right.from && left.to === right.to;
}

function transferKey(row: AnomalyAuditRow, flow: TransferFlow): string {
  const identity = row.agreementId
    ? `agreement:${row.turn}:${row.agreementId}`
    : `trace:${row.turn}:${row.traceId}`;
  return `${identity}:${flow.from}:${flow.to}`;
}

function pairCandidate(event: TransferEvent, row: AnomalyAuditRow, flow: TransferFlow): boolean {
  if (event.rows.length >= 2 || !sameFlow(event.flow, flow)) return false;

  const eventAgreementId = event.rows[0]?.agreementId;
  if (eventAgreementId || row.agreementId) {
    if (eventAgreementId !== row.agreementId) return false;
    const eventTraceId = event.rows[0]?.traceId;
    return eventTraceId !== row.traceId || seqAreAdjacent(event.lastSeq, row.seq);
  }

  const eventTraceId = event.rows[0]?.traceId;
  if (eventTraceId && row.traceId && eventTraceId !== row.traceId) return false;
  if (!seqAreAdjacent(event.lastSeq, row.seq)) return false;
  return (
    (event.lastSeq !== undefined && row.seq !== undefined) ||
    Math.abs(row.ts.getTime() - event.endedAt) <= PAIR_WINDOW_MS
  );
}

function buildTransferEvents(rows: readonly AnomalyAuditRow[]): TransferEvent[] {
  const events: TransferEvent[] = [];
  const candidatesByKey = new Map<string, TransferEvent[]>();
  const sorted = [...rows].sort(
    (a, b) =>
      a.ts.getTime() - b.ts.getTime() ||
      (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
  );
  for (const row of sorted) {
    const flow = flowOf(row);
    if (!flow || !isActorDriven(row)) continue;
    const rowTime = row.ts.getTime();
    const key = transferKey(row, flow);
    const candidates = candidatesByKey.get(key) ?? [];
    const candidateIndex = candidates.findIndex((candidate) => pairCandidate(candidate, row, flow));
    if (candidateIndex >= 0) {
      const event = candidates[candidateIndex];
      event.rows.push(row);
      event.startedAt = Math.min(event.startedAt, rowTime);
      event.endedAt = Math.max(event.endedAt, rowTime);
      event.lastSeq = row.seq;
      candidates.splice(candidateIndex, 1);
      continue;
    }
    const event: TransferEvent = {
      flow,
      startedAt: rowTime,
      endedAt: rowTime,
      lastSeq: row.seq,
      rows: [row],
    };
    events.push(event);
    candidates.push(event);
    candidatesByKey.set(key, candidates);
  }
  return events;
}

function seqAreAdjacent(left: number | undefined, right: number | undefined): boolean {
  return left === undefined || right === undefined || Math.abs(left - right) <= 1;
}

function findingOrNull(
  type: AuditAnomalyType,
  flaggedIds: Set<string>,
  detail: string
): AuditAnomalyFinding | null {
  return flaggedIds.size > 0 ? { type, detail, flaggedRows: flaggedIds.size } : null;
}

export function detectCircularWire(rows: readonly AnomalyAuditRow[]): TransferDetectorResult {
  const flaggedIds = new Set<string>();
  const events = buildTransferEvents(rows);
  const eventsByFlow = new Map<string, TransferEvent[]>();
  for (const event of events) {
    const key = flowKey(event.flow);
    const group = eventsByFlow.get(key) ?? [];
    group.push(event);
    eventsByFlow.set(key, group);
  }

  let roundTrips = 0;
  const processedPairs = new Set<string>();
  for (const [key, outbound] of eventsByFlow) {
    const [from, to] = key.split("\0");
    const reverseKey = flowKey({ from: to, to: from });
    const pairKey = [key, reverseKey].sort().join("|");
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);
    const inbound = eventsByFlow.get(reverseKey) ?? [];
    if (inbound.length === 0) continue;
    roundTrips += countLaterReturns(outbound, inbound, flaggedIds);
    roundTrips += countLaterReturns(inbound, outbound, flaggedIds);
  }

  return {
    flaggedIds,
    finding: findingOrNull(
      "circular_wire",
      flaggedIds,
      `${roundTrips} distinct A-to-B-to-A round trip(s) with a strictly later return event`
    ),
  };
}

export function detectWireFanInFanOut(
  rows: readonly AnomalyAuditRow[],
  config: TransferFlowConfig
): TransferDetectorResult {
  const flaggedIds = new Set<string>();
  const events = buildTransferEvents(rows);
  const inbound = new Map<string, Map<string, TransferEvent[]>>();
  const outbound = new Map<string, Map<string, TransferEvent[]>>();

  for (const event of events) {
    const inMap = inbound.get(event.flow.to) ?? new Map<string, TransferEvent[]>();
    const inboundEvents = inMap.get(event.flow.from) ?? [];
    inboundEvents.push(event);
    inMap.set(event.flow.from, inboundEvents);
    inbound.set(event.flow.to, inMap);

    const outMap = outbound.get(event.flow.from) ?? new Map<string, TransferEvent[]>();
    const outboundEvents = outMap.get(event.flow.to) ?? [];
    outboundEvents.push(event);
    outMap.set(event.flow.to, outboundEvents);
    outbound.set(event.flow.from, outMap);
  }

  let fanInHubs = 0;
  for (const bySender of inbound.values()) {
    if (bySender.size < config.fanInThreshold) continue;
    fanInHubs++;
    for (const eventGroup of bySender.values()) {
      for (const event of eventGroup) for (const row of event.rows) flaggedIds.add(row.id);
    }
  }

  let fanOutHubs = 0;
  for (const byRecipient of outbound.values()) {
    if (byRecipient.size < config.fanOutThreshold) continue;
    fanOutHubs++;
    for (const eventGroup of byRecipient.values()) {
      for (const event of eventGroup) for (const row of event.rows) flaggedIds.add(row.id);
    }
  }

  const excludedSettlementRows = rows.filter(
    (row) =>
      row.category === "money" && (SYSTEM_SETTLEMENT_ACTIONS.has(row.action) || !isActorDriven(row))
  ).length;
  const parts: string[] = [];
  if (fanInHubs > 0)
    parts.push(`${fanInHubs} fan-in hub(s) (>= ${config.fanInThreshold} distinct senders)`);
  if (fanOutHubs > 0) {
    parts.push(`${fanOutHubs} fan-out hub(s) (>= ${config.fanOutThreshold} distinct recipients)`);
  }
  if (excludedSettlementRows > 0) {
    parts.push(
      `${excludedSettlementRows} routine or system settlement row(s) excluded from hub baseline`
    );
  }

  return {
    flaggedIds,
    finding: findingOrNull("wire_fanin_fanout", flaggedIds, parts.join("; ")),
  };
}

function flowKey(flow: TransferFlow): string {
  return `${flow.from}\0${flow.to}`;
}

function countLaterReturns(
  outbound: readonly TransferEvent[],
  inbound: readonly TransferEvent[],
  flaggedIds: Set<string>
): number {
  const inboundStarts = inbound.map((event) => event.startedAt).sort((a, b) => a - b);
  const outboundEnds = outbound.map((event) => event.endedAt).sort((a, b) => a - b);
  let roundTrips = 0;

  for (const event of outbound) {
    const laterReturns = inbound.length - upperBound(inboundStarts, event.endedAt);
    if (laterReturns === 0) continue;
    roundTrips += laterReturns;
    for (const row of event.rows) flaggedIds.add(row.id);
  }
  for (const event of inbound) {
    if (lowerBound(outboundEnds, event.startedAt) === 0) continue;
    for (const row of event.rows) flaggedIds.add(row.id);
  }

  return roundTrips;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
