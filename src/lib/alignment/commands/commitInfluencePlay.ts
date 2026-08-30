/**
 * Commit an influence play: a member spends its organization's pooled fund to
 * pull a nation toward that org's alignment pole.
 *
 * The play is only QUEUED here. The alignment turn phase resolves it, so a play
 * lands with the same cap, resistance and locked-gate rules as drift.
 */
import { ObjectId, type Db } from "mongodb";
import { ALIGNMENT_GATES, resolveAlignmentEra } from "@/lib/constants/alignmentEras";
import { ROSTER_BY_KEY, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import type { CountryId } from "@/lib/constants/countries";
import {
  GDP_MILLIONS_TO_USD,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import { getAlignmentPlaysCollection, getCountryAlignmentsCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import {
  disburseFromOrganizationFund,
  localToUsd,
  resolveOrgFundCurrencyCountry,
} from "@/lib/internationalOrganizations/organizationFund";
import { loadGdpUsdMillionsByEntity } from "@/lib/internationalOrganizations/entityGdp";
import { isIntOrgAlignmentEnabled } from "../featureFlag";
import { leadFor } from "../project";
import { MIN_PLAY_POINTS, pointsForSpend } from "../influence";
import { roundToShareGrid } from "../normalize";

export type CommitPlayFailure =
  | "gate-off"
  | "no-channel"
  | "unknown-target"
  | "target-locked"
  | "unknown-target-economy"
  | "below-min-points"
  | "insufficient-funds";

export type CommitPlayResult =
  { ok: true; amountUsd: number } | { ok: false; reason: CommitPlayFailure };

export async function commitInfluencePlay(params: {
  db: Db;
  organizationId: InternationalOrganizationId;
  sponsorCountryId: CountryId;
  targetEntityId: string;
  amountLocal: number;
  turn: number;
  year: number;
}): Promise<CommitPlayResult> {
  const { db } = params;

  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { intOrgAlignmentEnabled: 1 } });
  if (!(await isIntOrgAlignmentEnabled(gs ?? {}))) return { ok: false, reason: "gate-off" };

  // An org can only carry influence through a channel this era defines. Most
  // orgs have none in most eras, and that is a refusal, not an error.
  const era = resolveAlignmentEra(params.year);
  const channel = era.channels.find((c) => c.organizationId === params.organizationId);
  if (!channel) return { ok: false, reason: "no-channel" };

  const key = params.targetEntityId as AlignmentCountryKey;
  if (!(key in ROSTER_BY_KEY)) return { ok: false, reason: "unknown-target" };

  const alignments = await getCountryAlignmentsCollection(db);
  const target = await alignments.findOne({ entityId: key });
  if (!target) return { ok: false, reason: "unknown-target" };

  // computeDrift no-ops a locked nation, so a play against one would take the
  // money and move nothing. Refuse BEFORE any debit — this is the guard that
  // keeps the mechanic honest.
  if (leadFor({ shares: target.shares, nonAligned: target.nonAligned }) >= ALIGNMENT_GATES.locked) {
    return { ok: false, reason: "target-locked" };
  }

  const amountLocal = Math.round(params.amountLocal);
  if (!(amountLocal > 0)) return { ok: false, reason: "insufficient-funds" };

  // Influence is priced against the target's own economy, so a target we cannot
  // price is refused BEFORE any debit. Treating it as free would make the
  // cheapest nation on the board the one we know least about.
  const gdpMillions = await loadGdpUsdMillionsByEntity(db, [key]);
  const targetGdpUsd = (gdpMillions.get(key) ?? 0) * GDP_MILLIONS_TO_USD;
  if (!(targetGdpUsd > 0)) return { ok: false, reason: "unknown-target-economy" };

  const fundCountry = await resolveOrgFundCurrencyCountry(db, params.organizationId);
  const amountUsd = localToUsd(fundCountry, amountLocal);

  // A spend too small to buy even one grid step (a hundredth of a point) would
  // resolve to zero applied points and be refunded a turn later — a submission
  // and a turn spent to move nothing, which reads as "the button does nothing".
  // Refuse it up front, BEFORE any debit, so the panel can tell the player the
  // minimum spend instead. Priced on the raw points the spend buys, matching the
  // per-point cost the dossier quotes (ticket #1213).
  if (roundToShareGrid(pointsForSpend(amountUsd, targetGdpUsd)) < MIN_PLAY_POINTS) {
    return { ok: false, reason: "below-min-points" };
  }

  // Atomic: the disburse guards on balanceLocal >= amount, so two members
  // spending at once cannot both win. Never pre-read the balance.
  const paid = await disburseFromOrganizationFund(db, params.organizationId, amountLocal);
  if (!paid) return { ok: false, reason: "insufficient-funds" };

  const plays = await getAlignmentPlaysCollection(db);
  await plays.insertOne({
    _id: new ObjectId(),
    organizationId: params.organizationId,
    sponsorCountryId: params.sponsorCountryId,
    targetEntityId: key,
    amountUsd,
    amountLocal,
    turn: params.turn,
    resolvedTurn: null,
    appliedPoints: null,
    createdAt: new Date(),
  });

  return { ok: true, amountUsd };
}
