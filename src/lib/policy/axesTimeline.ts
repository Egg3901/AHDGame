import { computeNationalAxes, type AxisInputRecord } from "./nationalAxes";

/**
 * Retroactive National Ideology timeline, replayed from enacted-law history —
 * powers the lander's drift sparklines and movers feed, and the National
 * Policy page's Record view. No per-turn snapshot collection: history is
 * derived by replaying `enactedLaws` in enactment order, where each new law of
 * a legislation type REPLACES that type's prior contribution (the live
 * average is over one current record per type).
 *
 * Coverage caveat (accepted at design review): the replay only sees what
 * `enactedLaws` recorded — surfaces label the series "since first recorded
 * law" and must not assume the series end equals the live average.
 */

export interface EnactedLawLike {
  title: string;
  legislationTypeId: string;
  policyOptionIndex?: number;
  enactedAt: Date;
  enactedYear: number;
}

export interface LegislationTypeLike {
  _id: string;
  policyOptions?: { economic?: number; social?: number }[];
}

export interface AxisEvent {
  /** Resolved (canonical) legislation type id — replacement key. */
  typeKey: string;
  title: string;
  enactedAt: Date;
  enactedYear: number;
  /** Option value on each axis the type carries; null when the type has no position on that axis. */
  economic: number | null;
  social: number | null;
}

export interface TimelinePoint {
  enactedAt: Date;
  enactedYear: number;
  economicAvg: number | null;
  socialAvg: number | null;
}

export interface AxisMover extends AxisEvent {
  economicBefore: number | null;
  economicAfter: number | null;
  socialBefore: number | null;
  socialAfter: number | null;
}

/**
 * Derive axis events from enacted laws. A type "carries" an axis when any of
 * its options takes a non-zero position there (mirrors the policy API's
 * hasEconomic/hasSocial); the enacted option's value — including an explicit
 * 0 — is the event value on carried axes. Laws whose type, options, or
 * enacted option can't be resolved are skipped, as are laws carrying no axis.
 */
export function buildAxisEvents(
  laws: readonly EnactedLawLike[],
  resolveType: (legislationTypeId: string) => LegislationTypeLike | undefined
): AxisEvent[] {
  const events: AxisEvent[] = [];
  for (const enactedLaw of laws) {
    const type = resolveType(enactedLaw.legislationTypeId);
    const options = type?.policyOptions;
    if (!type || !options?.length) continue;
    if (enactedLaw.policyOptionIndex == null) continue;
    const option = options[enactedLaw.policyOptionIndex];
    if (!option) continue;
    const carriesEconomic = options.some((o) => (o.economic ?? 0) !== 0);
    const carriesSocial = options.some((o) => (o.social ?? 0) !== 0);
    if (!carriesEconomic && !carriesSocial) continue;
    events.push({
      typeKey: type._id,
      title: enactedLaw.title,
      enactedAt: enactedLaw.enactedAt,
      enactedYear: enactedLaw.enactedYear,
      economic: carriesEconomic ? (option.economic ?? 0) : null,
      social: carriesSocial ? (option.social ?? 0) : null,
    });
  }
  return events;
}

function stateAverages(state: Map<string, AxisEvent>): {
  economic: number | null;
  social: number | null;
} {
  const records: AxisInputRecord[] = [...state.values()].map((event) => ({
    recordType: "policy",
    economic: event.economic ?? 0,
    social: event.social ?? 0,
    hasEconomic: event.economic !== null,
    hasSocial: event.social !== null,
  }));
  const axes = computeNationalAxes(records);
  return { economic: axes.economic, social: axes.social };
}

const MOVERS_LIMIT = 5;

/**
 * Replay events (chronologically sorted, oldest first) into the running
 * per-axis average series plus the per-event pulls. `events` is the full
 * enriched chronology (Record-view nodes); `movers` is the 5 most recent,
 * newest first (lander feed).
 */
export function replayAxesTimeline(events: readonly AxisEvent[]): {
  points: TimelinePoint[];
  movers: AxisMover[];
  events: AxisMover[];
} {
  const state = new Map<string, AxisEvent>();
  const points: TimelinePoint[] = [];
  const enriched: AxisMover[] = [];
  for (const event of events) {
    const before = stateAverages(state);
    state.set(event.typeKey, event);
    const after = stateAverages(state);
    points.push({
      enactedAt: event.enactedAt,
      enactedYear: event.enactedYear,
      economicAvg: after.economic,
      socialAvg: after.social,
    });
    enriched.push({
      ...event,
      economicBefore: event.economic === null ? null : before.economic,
      economicAfter: event.economic === null ? null : after.economic,
      socialBefore: event.social === null ? null : before.social,
      socialAfter: event.social === null ? null : after.social,
    });
  }
  return { points, movers: enriched.slice(-MOVERS_LIMIT).reverse(), events: enriched };
}
