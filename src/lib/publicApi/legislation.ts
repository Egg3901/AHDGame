import type { Db } from "mongodb";
import type { Bill, BillProvision } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";

type LegislationStatus = "pending" | "passed" | "failed";

const STATUS_MAP: Record<LegislationStatus, string[]> = {
  pending: ["proposed", "active", "passed_origin", "active_other", "enrolled", "cabinet_review"],
  passed: ["signed", "veto_override", "unsigned_law"],
  failed: ["failed", "vetoed", "override_failed", "withdrawn", "filibustered"],
};

function mapProvisionToEffect(provision: BillProvision): { metric: string; direction: string } {
  if (isPolicyProvision(provision)) {
    return {
      metric: provision.legislationTypeId ?? "policy",
      direction: (provision.effectDirection ?? 0) >= 0 ? "increase" : "decrease",
    };
  }
  if (provision.type === "tariff") return { metric: "tariff", direction: "change" };
  if (provision.type === "subsidy") return { metric: "subsidy", direction: "increase" };
  if (provision.type === "end_subsidy") return { metric: "subsidy", direction: "decrease" };
  return {
    metric: (provision as unknown as { type?: string }).type ?? "unknown",
    direction: "change",
  };
}

export async function queryLegislation(
  db: Db,
  params: { country?: string; status?: string; limit?: number }
) {
  const { country, status, limit = 20 } = params;

  const query: Record<string, unknown> = {};
  if (country) query.countryId = country;

  if (status && status in STATUS_MAP) {
    query.status = { $in: STATUS_MAP[status as LegislationStatus] };
  }

  const bills = await db
    .collection<Bill>("bills")
    .find(query)
    .sort({ proposedAt: -1 })
    .limit(Math.min(limit, 100))
    .toArray();

  if (bills.length === 0) return { found: false, bills: [] };

  const result = bills.map((b) => ({
    id: b._id.toString(),
    title: b.title,
    sponsor: b.sponsorName ?? null,
    sponsorParty: b.sponsorParty ?? null,
    country: b.countryId ?? null,
    status: b.status,
    introducedAt: b.proposedAt?.toISOString() ?? null,
    votedAt:
      b.enactedAt?.toISOString() ??
      b.failedAt?.toISOString() ??
      b.passedOriginAt?.toISOString() ??
      null,
    vote: {
      yes: b.votesFor ?? 0,
      no: b.votesAgainst ?? 0,
      abstain: b.votesAbstain ?? 0,
    },
    effects: (b.provisions ?? []).map(mapProvisionToEffect),
  }));

  return { found: true, bills: result };
}
