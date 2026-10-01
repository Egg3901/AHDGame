import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import { captureServerGameEvent } from "./serverPosthog";

const BILL_STATUSES = new Set([
  "proposed",
  "active",
  "passed_origin",
  "active_other",
  "active_both",
  "enrolled",
  "signed",
  "failed",
  "veto_override",
  "override_failed",
  "override_shugiin",
  "passed",
  "enacted",
  "vote_closing",
  "override_closing",
  "vetoed",
  "withdrawn",
  "cabinet_review",
  "filibustered",
]);
const BILL_CHAMBERS = new Set([
  "house",
  "senate",
  "commons",
  "lords",
  "shugiin",
  "sangiin",
  "bundestag",
  "landtag",
  "assembly",
  "parliament",
  "cabinet",
  "regional",
  "unknown",
]);
const BILL_CATEGORIES = new Set([
  "agriculture",
  "custom",
  "defence",
  "defense",
  "economic",
  "economy",
  "education",
  "energy",
  "environment",
  "finance",
  "foreign",
  "governance",
  "health",
  "healthcare",
  "industry",
  "infrastructure",
  "justice",
  "labour",
  "labor",
  "media",
  "media_information",
  "monetary",
  "other",
  "population",
  "public_safety",
  "social",
  "tax",
  "trade",
]);
const PROVISION_FAMILIES = new Set([
  "central_bank_independence",
  "create_department",
  "declare_war",
  "designate_strategic_sector",
  "electoral_law",
  "embargo",
  "end_embargo",
  "end_subsidy",
  "euro_adoption",
  "international_organization",
  "join_conflict",
  "nationalize",
  "policy",
  "privatize",
  "subsidy",
  "tariff",
  "union_law",
]);

function enumValue(value: string | undefined, allowed: Set<string>): string {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return normalized && allowed.has(normalized) ? normalized : "other";
}

/** Report only committed, non-transient bill lifecycle status transitions. */
export async function captureBillStatusChanged(input: {
  db: Db;
  billId: string;
  fromStatus: string;
  toStatus: string;
  scope: "national" | "regional";
  chamber?: string;
  category?: string;
  provisionFamily?: string;
  voteMargin?: number;
  nationId?: string;
  turn: number;
  iteration?: GameIteration | null;
}): Promise<void> {
  if (
    input.fromStatus === input.toStatus ||
    input.toStatus === "vote_closing" ||
    input.toStatus === "override_closing"
  )
    return;
  await captureServerGameEvent({
    db: input.db,
    event: "bill_status_changed",
    distinctId: "system:bill-lifecycle",
    turn: input.turn,
    iteration: input.iteration,
    ...(input.nationId ? { nationId: input.nationId } : {}),
    properties: {
      bill_id: input.billId,
      from_status: enumValue(input.fromStatus, BILL_STATUSES),
      to_status: enumValue(input.toStatus, BILL_STATUSES),
      scope: input.scope,
      chamber: enumValue(input.chamber, BILL_CHAMBERS),
      category: enumValue(input.category, BILL_CATEGORIES),
      provision_family: enumValue(input.provisionFamily, PROVISION_FAMILIES),
      ...(Number.isFinite(input.voteMargin) ? { vote_margin: input.voteMargin! } : {}),
    },
  });
}

/** Server truth for enactment, including regional bills that skip country history. */
export async function captureBillPassed(input: {
  db: Db;
  billId: string;
  scope: "national" | "regional";
  nationId?: string;
  turn: number;
  iteration?: GameIteration | null;
}): Promise<void> {
  await captureServerGameEvent({
    db: input.db,
    event: "bill_passed",
    distinctId: "system:bill-lifecycle",
    insertId: `bill-passed:${input.billId}`,
    turn: input.turn,
    iteration: input.iteration,
    ...(input.nationId ? { nationId: input.nationId } : {}),
    properties: {
      bill_id: input.billId,
      scope: input.scope,
    },
  });
}
