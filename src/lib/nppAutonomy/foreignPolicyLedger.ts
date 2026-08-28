import type { ForeignPolicyChoice } from "./foreignPolicy";

export interface ForeignPolicyLedgerDecision {
  countryId: string;
  turn: number;
  selected: ForeignPolicyChoice | null;
  acted: boolean;
  executionStatus: "planned" | "claimed" | "executed" | "rejected" | "no_action";
  executionNote: string;
}

interface CountRow {
  key: string;
  count: number;
}

interface CountryRow {
  countryId: string;
  decisions: number;
  acted: number;
  rejected: number;
  noAction: number;
}

export interface ForeignPolicyLedgerSummary {
  totals: {
    decisions: number;
    acted: number;
    rejected: number;
    noAction: number;
    pendingClaims: number;
    vetoes: number;
    warEntries: number;
  };
  countries: CountryRow[];
  actionMix: CountRow[];
  targets: CountRow[];
  rejectionReasons: CountRow[];
  noActionReasons: CountRow[];
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function rows(map: Map<string, number>): CountRow[] {
  return Array.from(map, ([key, count]) => ({ key, count })).sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key)
  );
}

export function summarizeForeignPolicyLedger(
  decisions: ForeignPolicyLedgerDecision[]
): ForeignPolicyLedgerSummary {
  const countries = new Map<string, CountryRow>();
  const actionMix = new Map<string, number>();
  const targets = new Map<string, number>();
  const rejectionReasons = new Map<string, number>();
  const noActionReasons = new Map<string, number>();
  let acted = 0;
  let rejected = 0;
  let noAction = 0;
  let pendingClaims = 0;
  let vetoes = 0;
  let warEntries = 0;

  for (const decision of decisions) {
    const country = countries.get(decision.countryId) ?? {
      countryId: decision.countryId,
      decisions: 0,
      acted: 0,
      rejected: 0,
      noAction: 0,
    };
    country.decisions++;
    if (decision.acted) {
      acted++;
      country.acted++;
    }
    if (decision.executionStatus === "rejected") {
      rejected++;
      country.rejected++;
      increment(rejectionReasons, decision.executionNote);
    } else if (decision.executionStatus === "no_action") {
      noAction++;
      country.noAction++;
      increment(noActionReasons, decision.executionNote);
    } else if (decision.executionStatus === "claimed") {
      pendingClaims++;
    }
    countries.set(decision.countryId, country);

    const choice = decision.selected;
    if (!choice) continue;
    increment(actionMix, choice.type);
    if (choice.targetCountryId) increment(targets, choice.targetCountryId);
    if (choice.type === "vote_org_no" && decision.acted) vetoes++;
    if (choice.type === "join_war" && decision.acted) warEntries++;
  }

  return {
    totals: {
      decisions: decisions.length,
      acted,
      rejected,
      noAction,
      pendingClaims,
      vetoes,
      warEntries,
    },
    countries: Array.from(countries.values()).sort(
      (a, b) =>
        b.acted - a.acted || b.decisions - a.decisions || a.countryId.localeCompare(b.countryId)
    ),
    actionMix: rows(actionMix),
    targets: rows(targets),
    rejectionReasons: rows(rejectionReasons),
    noActionReasons: rows(noActionReasons),
  };
}
