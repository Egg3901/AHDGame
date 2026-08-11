/**
 * Crisis lifecycle: opening flashpoints and settling the auctions over them.
 *
 * Kept out of the alignment turn phase so that phase stays readable.
 *
 * A crisis has no payout of its own. While one is open its target's movement
 * ceiling is raised (see CRISIS_TURN_CAP), so ordinary plays against that nation
 * can go further than they could anywhere else — and a crisis nobody acts on
 * changes nothing at all.
 */
import { ObjectId, type Db } from "mongodb";
import { ALIGNMENT_GATES, polesForYear } from "@/lib/constants/alignmentEras";
import type { AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { getAlignmentCrisesCollection } from "@/lib/db/collections";
import type { AlignmentCrisis } from "@/lib/db/types/alignmentCrisis";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { CRISIS_WINDOW_TURNS, mostContested, tugOfWarCandidate } from "./crisis";
import { EMERGENT_CRISES, authoredCrisesForYear } from "./crisisCatalog";
import { SUSTAIN_TURNS } from "./membershipEligibility";
import type { AlignmentShares } from "./normalize";
import { leadFor } from "./project";

/** Most crises open at once, so the desk never floods. */
export const MAX_OPEN_CRISES = 3;

/** A member is in visible trouble once it is halfway to walking out. */
const DEFECTION_CRISIS_AT = SUSTAIN_TURNS / 2;

export interface CrisisTurnRow {
  entityId: string;
  shares: AlignmentShares;
}

/**
 * Settle every crisis whose window has closed.
 *
 * Returns the points awarded per entity, for the caller to fold into that
 * nation's pull vector this turn.
 */
export async function closeDueCrises(
  db: Db,
  params: { currentTurn: number }
): Promise<{ crisesResolved: number }> {
  const crises = await getAlignmentCrisesCollection(db);
  const due = await crises
    .find({ status: "open", closesTurn: { $lte: params.currentTurn } })
    .toArray();

  for (const crisis of due) {
    await crises.updateOne(
      { _id: crisis._id },
      { $set: { status: "resolved", resolvedTurn: params.currentTurn } }
    );
  }
  return { crisesResolved: due.length };
}

/** Entity ids with an open crisis, so the phase can raise their movement cap. */
export async function openCrisisTargets(db: Db): Promise<Set<string>> {
  const crises = await getAlignmentCrisesCollection(db);
  const open = await crises.find({ status: "open" }).toArray();
  return new Set(open.map((c) => c.targetEntityId as string));
}

/**
 * Open new flashpoints, up to the global cap.
 *
 * Precedence: authored anchors first (they are the set-pieces), then emergent
 * defection crises, then emergent tugs-of-war. One open crisis per nation.
 */
export async function openDueCrises(
  db: Db,
  params: {
    currentTurn: number;
    year: number;
    rows: readonly CrisisTurnRow[];
    memberships: readonly OrganizationMembership[];
  }
): Promise<{ crisesOpened: number }> {
  const crises = await getAlignmentCrisesCollection(db);
  const poles = polesForYear(params.year);

  const open = await crises.find({ status: "open" }).toArray();
  let slots = MAX_OPEN_CRISES - open.length;
  if (slots <= 0) return { crisesOpened: 0 };

  const spokenFor = new Set(open.map((c) => c.targetEntityId as string));
  const byEntity = new Map(params.rows.map((r) => [r.entityId, r]));

  /** A nation nothing could move is not a flashpoint. */
  const movable = (entityId: string) => {
    const row = byEntity.get(entityId);
    return row != null && leadFor(row.shares) < ALIGNMENT_GATES.locked;
  };

  const candidates: Array<Omit<AlignmentCrisis, "_id" | "createdAt">> = [];

  // 1. Authored anchors, once each per world.
  const alreadyRun = new Set((await crises.find({}).toArray()).map((c) => c.kind));
  for (const authored of authoredCrisesForYear(params.year)) {
    if (alreadyRun.has(authored.kind)) continue;

    // Retarget rather than fizzle: Egypt and Cuba are not implemented, and a
    // locked nation could not be moved by the crisis anyway.
    let target = authored.targetEntityId;
    let retargetedFrom: string | null = null;
    if (!movable(target) || spokenFor.has(target)) {
      const fallback = mostContested(
        params.rows.filter((r) => !spokenFor.has(r.entityId) && movable(r.entityId)),
        poles
      );
      if (!fallback) continue;
      retargetedFrom = target;
      target = fallback;
    }

    candidates.push({
      kind: authored.kind,
      targetEntityId: target as AlignmentCountryKey,
      title: authored.title,
      headline: authored.headline,
      openedTurn: params.currentTurn,
      closesTurn: params.currentTurn + CRISIS_WINDOW_TURNS,
      status: "open",
      resolvedTurn: null,
      retargetedFrom,
    });
    spokenFor.add(target);
  }

  // 2. A member visibly slipping out of its bloc.
  for (const membership of params.memberships) {
    if (membership.wantsOutSinceTurn == null) continue;
    if (params.currentTurn - membership.wantsOutSinceTurn < DEFECTION_CRISIS_AT) continue;
    if (spokenFor.has(membership.countryId) || !movable(membership.countryId)) continue;

    candidates.push({
      kind: EMERGENT_CRISES.defection.kind,
      targetEntityId: membership.countryId as AlignmentCountryKey,
      title: EMERGENT_CRISES.defection.title,
      headline: EMERGENT_CRISES.defection.headline,
      openedTurn: params.currentTurn,
      closesTurn: params.currentTurn + CRISIS_WINDOW_TURNS,
      status: "open",
      resolvedTurn: null,
      retargetedFrom: null,
    });
    spokenFor.add(membership.countryId);
  }

  // 3. A country two blocs are both dug into.
  for (const row of params.rows) {
    if (spokenFor.has(row.entityId) || !movable(row.entityId)) continue;
    if (!tugOfWarCandidate(row.shares, poles)) continue;

    candidates.push({
      kind: EMERGENT_CRISES.tugOfWar.kind,
      targetEntityId: row.entityId as AlignmentCountryKey,
      title: EMERGENT_CRISES.tugOfWar.title,
      headline: EMERGENT_CRISES.tugOfWar.headline,
      openedTurn: params.currentTurn,
      closesTurn: params.currentTurn + CRISIS_WINDOW_TURNS,
      status: "open",
      resolvedTurn: null,
      retargetedFrom: null,
    });
    spokenFor.add(row.entityId);
  }

  let crisesOpened = 0;
  const now = new Date();
  for (const candidate of candidates) {
    if (slots <= 0) break;
    await crises.insertOne({ _id: new ObjectId(), ...candidate, createdAt: now });
    slots--;
    crisesOpened++;
  }
  return { crisesOpened };
}
