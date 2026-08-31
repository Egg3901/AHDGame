/**
 * PM decision on a requested referendum. The Prime Minister grants it (opening
 * the campaign) or declines it (cooldown). There is no separate Commons consent
 * vote at this stage — Westminster's legislative consent comes later as a
 * Commons bill at the conversion stage (alongside Ireland's Dáil bill).
 *
 * See docs/superpowers/specs/2026-06-16-independence-process-design.md §6.
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  CAMPAIGN_WINDOW_TURNS,
  DECLINE_COOLDOWN_TURNS,
  DECLINE_DESIRE_BUMP,
} from "@/lib/constants/referendum";
import { announceReferendumDecision } from "@/lib/referendum/referendumWebhooks";
import { recordWireEvent } from "@/lib/referendum/wire";

export type GrantReferendumAction = "grant" | "decline";

export interface GrantReferendumInput {
  countryId: CountryId;
  referendumId: string;
  /** True when the acting character is the sitting UK PM. */
  isPM: boolean;
  action: GrantReferendumAction;
  /** Admin override — bypasses the PM gate. Routes must verify the caller. */
  adminOverride?: boolean;
}

export interface GrantReferendumResult {
  status: number;
  body: { error?: string; campaignCloseTurn?: number; declined?: boolean };
}

export async function grantReferendum(
  db: Db,
  input: GrantReferendumInput
): Promise<GrantReferendumResult> {
  if (input.countryId !== "UK") {
    return { status: 400, body: { error: "Referendums are UK-only." } };
  }
  if (!input.isPM && input.adminOverride !== true) {
    return { status: 403, body: { error: "Only the Prime Minister can decide on a referendum." } };
  }

  const refs = getReferendumCollection(db);
  const ref = await refs.findOne({ _id: new ObjectId(input.referendumId) });
  if (!ref) return { status: 404, body: { error: "Referendum not found." } };
  if (ref.status !== "requested") {
    return { status: 400, body: { error: "Referendum is not awaiting a decision." } };
  }

  const currentTurn = await getCurrentTurn(db);

  if (input.action === "decline") {
    await refs.updateOne(
      { _id: ref._id },
      {
        $set: {
          status: "declined",
          cooldownReadyAtTurn: currentTurn + DECLINE_COOLDOWN_TURNS,
          updatedAt: new Date(),
        },
      }
    );
    // A rebuffed petition inflames the cause: nudge the region's desire up
    // (clamped to 100) so a decline is not a free way to bury the question.
    // SP5: independenceDesire lives top-level on macroMetrics.
    const metric = await db
      .collection<MacroMetricsDoc>("macroMetrics")
      .findOne({ _id: ref.regionId });
    const current = metric?.independenceDesire?.value ?? ref.yesShare;
    await db.collection<MacroMetricsDoc>("macroMetrics").updateOne(
      { _id: ref.regionId },
      {
        $set: {
          "independenceDesire.value": Math.min(100, current + DECLINE_DESIRE_BUMP),
          lastUpdated: new Date(),
        },
      }
    );
    await announceReferendumDecision(ref, "decline").catch(() => {});
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: currentTurn,
      kind: "declined",
      summary: "The Prime Minister declined the referendum.",
    }).catch(() => {});
    return { status: 200, body: { declined: true } };
  }

  const closeTurn = currentTurn + CAMPAIGN_WINDOW_TURNS;
  // Seed the campaign baseline from the region's CURRENT desire at grant time
  // (spec §7), so the Yes share starts from where sentiment actually sits.
  const metric = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .findOne({ _id: ref.regionId });
  const baseYesShare = metric?.independenceDesire?.value ?? ref.yesShare;
  await refs.updateOne(
    { _id: ref._id },
    {
      $set: {
        status: "granted",
        grantedTurn: currentTurn,
        campaignOpenTurn: currentTurn,
        campaignCloseTurn: closeTurn,
        campaignBaseYesShare: baseYesShare,
        yesShare: baseYesShare,
        updatedAt: new Date(),
      },
    }
  );
  await announceReferendumDecision(ref, "grant").catch(() => {});
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: currentTurn,
    kind: "granted",
    summary: "The Prime Minister granted the referendum.",
  }).catch(() => {});
  return { status: 200, body: { campaignCloseTurn: closeTurn } };
}
