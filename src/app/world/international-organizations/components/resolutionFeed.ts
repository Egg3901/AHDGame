import type { OrgSummary } from "../orgTypes";

export interface FeedItem {
  _id: string;
  orgId: string;
  orgName: string;
  orgShortName: string;
  title: string;
  type: string;
  status: "pending" | "active";
  closesOnTurn?: number;
  enactedOnTurn?: number;
}

/**
 * Flatten every org's pending + active legislation into one cross-org feed:
 * pending first (soonest close), then active (most-recent enactment). Pure.
 */
export function buildResolutionFeed(orgs: OrgSummary[]): FeedItem[] {
  const pending: FeedItem[] = [];
  const active: FeedItem[] = [];
  for (const org of orgs) {
    for (const l of org.pendingLegislation) {
      pending.push({
        _id: l._id.toString(),
        orgId: org.id,
        orgName: org.def.name,
        orgShortName: org.def.shortName,
        title: l.title,
        type: l.type,
        status: "pending",
        closesOnTurn: l.closesOnTurn,
      });
    }
    for (const l of org.activeLegislation) {
      active.push({
        _id: l._id.toString(),
        orgId: org.id,
        orgName: org.def.name,
        orgShortName: org.def.shortName,
        title: l.title,
        type: l.type,
        status: "active",
        enactedOnTurn: l.enactedOnTurn,
      });
    }
  }
  pending.sort((a, b) => (a.closesOnTurn ?? 0) - (b.closesOnTurn ?? 0));
  active.sort((a, b) => (b.enactedOnTurn ?? 0) - (a.enactedOnTurn ?? 0));
  return [...pending, ...active];
}
