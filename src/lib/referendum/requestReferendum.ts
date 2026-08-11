/**
 * Domain logic for a UK First Minister requesting an independence /
 * reunification referendum. Mirrors the changeDevolutionPolicy contract:
 * validate inputs + eligibility + AP, write the referendum doc, decrement AP,
 * return a thin status/body for the API route.
 *
 * See docs/superpowers/specs/2026-06-16-independence-process-design.md.
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { CountryId } from "@/lib/constants/countries";
import type { GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
import type { StateMetrics } from "@/lib/db/types";
import type { Referendum, ReferendumKind, ReferendumStatus } from "@/lib/db/types/referendum";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isUKDevolutionRegion } from "@/lib/constants/devolution";
import { REQUEST_AP_COST, referendumRequestEligibility } from "@/lib/constants/referendum";
import { announceReferendumRequested } from "@/lib/referendum/referendumWebhooks";
import { recordWireEvent } from "@/lib/referendum/wire";

/** Non-terminal statuses that count as "a referendum is in progress". */
const ACTIVE_STATUSES: ReferendumStatus[] = [
  "requested",
  "granted",
  "campaigning",
  "polling",
  "actuating",
];

/** Terminal statuses whose most-recent row supplies the cooldown gate. */
const TERMINAL_STATUSES: ReferendumStatus[] = ["declined", "settled", "completed", "cancelled"];

export interface RequestReferendumInput {
  countryId: CountryId;
  stateId: string;
  /** Admin override — bypasses eligibility + AP. Routes must verify the caller. */
  adminOverride?: boolean;
}

export interface RequestReferendumResult {
  status: number;
  body: { error?: string; referendumId?: string; kind?: ReferendumKind };
}

export async function requestReferendum(
  db: Db,
  input: RequestReferendumInput
): Promise<RequestReferendumResult> {
  const { countryId } = input;
  const stateId = input.stateId.toUpperCase();
  const adminOverride = input.adminOverride === true;

  if (countryId !== "UK") return { status: 400, body: { error: "Referendums are UK-only." } };
  if (!isUKDevolutionRegion(stateId)) {
    return { status: 400, body: { error: "Region cannot hold an independence referendum." } };
  }

  const currentTurn = await getCurrentTurn(db);
  const refs = getReferendumCollection(db);

  const active = await refs.findOne({ regionId: stateId, status: { $in: ACTIVE_STATUSES } });
  const lastTerminal = await refs
    .find({ regionId: stateId, status: { $in: TERMINAL_STATUSES } })
    .sort({ updatedAt: -1 })
    .limit(1)
    .toArray();

  // SP5: independenceDesire lives top-level on macroMetrics.
  const metric = await db.collection<MacroMetricsDoc>("macroMetrics").findOne({ _id: stateId });
  const desire = metric?.independenceDesire?.value ?? 0;

  const elig = referendumRequestEligibility({
    desire,
    hasActiveReferendum: active != null,
    cooldownReadyAtTurn: lastTerminal[0]?.cooldownReadyAtTurn ?? null,
    currentTurn,
  });
  if (!elig.eligible && !adminOverride) return { status: 400, body: { error: elig.reason } };

  const office = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .findOne({ countryId, stateId });
  if (!office) return { status: 400, body: { error: "Office state row missing." } };
  if (!adminOverride && office.gubernatorialActions < REQUEST_AP_COST) {
    return { status: 400, body: { error: "Insufficient office action points." } };
  }

  const kind: ReferendumKind = stateId === "NIR" ? "reunification" : "independence";
  const now = new Date();
  const doc: Referendum = {
    countryId,
    regionId: stateId,
    kind,
    targetCountryId: stateId === "NIR" ? "IE" : null,
    status: "requested",
    requestedTurn: currentTurn,
    grantedTurn: null,
    campaignOpenTurn: null,
    campaignCloseTurn: null,
    yesShare: desire,
    campaignBaseYesShare: desire,
    campaignSpendUnits: { yes: 0, no: 0 },
    conversionDeadlineTurn: null,
    westminsterBillId: null,
    dailBillId: null,
    result: null,
    cooldownReadyAtTurn: null,
    createdAt: now,
    updatedAt: now,
  };
  const ins = await refs.insertOne(doc);

  await announceReferendumRequested({ ...doc, _id: ins.insertedId }).catch(() => {});
  await recordWireEvent(db, {
    referendumId: ins.insertedId,
    countryId,
    regionId: stateId,
    turn: currentTurn,
    kind: "requested",
    summary: `The First Minister requested a ${
      kind === "reunification" ? "reunification" : "independence"
    } referendum.`,
  }).catch(() => {});

  if (!adminOverride) {
    await db
      .collection<GovernorOfficeState>("governorOfficeState")
      .updateOne(
        { countryId, stateId },
        { $inc: { gubernatorialActions: -REQUEST_AP_COST }, $set: { updatedAt: now } }
      );
  }

  return { status: 200, body: { referendumId: String(ins.insertedId), kind } };
}
