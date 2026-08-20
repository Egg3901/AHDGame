import type { BroadcastChannel, EventSeverity, FiredEvent } from "./types";

/**
 * The broadcast bus. One fired event fans out to many sinks (the in-game news
 * wire, a nation's wire, Discord channels, a future push) so an author writes a
 * beat once and it lands everywhere. Sinks register against channels; the bus
 * enforces the policy that keeps a bold event system from becoming spam.
 *
 * Everything here is pure/deterministic except the sinks themselves. The bus
 * decides WHAT publishes WHERE; a sink decides how to deliver it.
 */

export interface BroadcastTarget {
  channel: BroadcastChannel;
  /** Nation this lands on, for the *_national channels. Omitted for global. */
  nation?: string;
}

export interface PublishedMessage {
  eventId: string;
  headline: string;
  body: string;
  severity: EventSeverity;
  target: BroadcastTarget;
}

export interface BroadcastSink {
  channel: BroadcastChannel;
  /** Minimum severity this sink accepts. Discord sinks sit high to avoid spam. */
  minSeverity: EventSeverity;
  deliver(message: PublishedMessage): Promise<void>;
}

const SEVERITY_RANK: Record<EventSeverity, number> = { minor: 0, major: 1, critical: 2 };

export function meetsSeverity(sink: BroadcastSink, severity: EventSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[sink.minSeverity];
}

/**
 * Which targets a fired event should reach, before per-sink severity filtering.
 * Global-severity events always hit the global wire; national channels are added
 * for each affected nation. Discord targets are only added for major+ events, so
 * minor beats stay in-game.
 */
export function targetsFor(event: FiredEvent, affectedNations: string[]): BroadcastTarget[] {
  const severity = event.event.severity;
  const targets: BroadcastTarget[] = [{ channel: "wire_global" }];
  for (const nation of affectedNations) {
    targets.push({ channel: "wire_national", nation });
  }
  if (SEVERITY_RANK[severity] >= SEVERITY_RANK.major) {
    targets.push({ channel: "discord_global" });
    for (const nation of affectedNations) {
      targets.push({ channel: "discord_national", nation });
    }
  }
  return targets;
}

export interface BroadcastPolicy {
  /** Already-published event ids, so a replayed turn re-emits nothing. */
  publishedIds: Set<string>;
  /** Per (channel:nation) count this window, to rate-limit a noisy turn. */
  perTargetCount: Map<string, number>;
  /** Max messages to a single target per publish window. */
  maxPerTarget: number;
}

export function newPolicy(maxPerTarget = 3): BroadcastPolicy {
  return { publishedIds: new Set(), perTargetCount: new Map(), maxPerTarget };
}

function targetKey(t: BroadcastTarget): string {
  return `${t.channel}:${t.nation ?? "*"}`;
}

/**
 * Publish a fired event across the registered sinks under the policy. Pure
 * orchestration: dedupes by event id, applies the per-target rate limit and each
 * sink's severity floor, then calls the sink. Returns the messages delivered.
 */
export async function publishEvent(
  event: FiredEvent,
  affectedNations: string[],
  sinks: BroadcastSink[],
  policy: BroadcastPolicy
): Promise<PublishedMessage[]> {
  if (policy.publishedIds.has(event.id)) return [];
  policy.publishedIds.add(event.id);

  const delivered: PublishedMessage[] = [];
  for (const target of targetsFor(event, affectedNations)) {
    const key = targetKey(target);
    const count = policy.perTargetCount.get(key) ?? 0;
    if (count >= policy.maxPerTarget) continue;

    for (const sink of sinks) {
      if (sink.channel !== target.channel) continue;
      if (!meetsSeverity(sink, event.event.severity)) continue;
      const message: PublishedMessage = {
        eventId: event.id,
        headline: event.event.headline,
        body: event.event.body,
        severity: event.event.severity,
        target,
      };
      await sink.deliver(message);
      delivered.push(message);
      policy.perTargetCount.set(key, count + 1);
    }
  }
  return delivered;
}
