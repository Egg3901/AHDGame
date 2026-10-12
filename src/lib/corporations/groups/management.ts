/**
 * Subsidiary group management lets the parent set identity and strategy while player CEOs choose receiving participation.
 * Settings do not themselves move cash or goods; supply settlement is a separate qualified engine capability.
 */
import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import { groupHistoryInAnchor } from "./rules/financialHistory";
import type { Corporation, GameState } from "@/lib/db/types";
import { requireCeo } from "@/lib/api/corporations/resolveQuery";
import { resolveFormalizedGroups } from "./groupMembership";
import { canActOnCorporationAsParent } from "../subsidiaries/authorization";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import {
  scheduleGroupReceiving,
  effectiveGroupReceiving,
  type GroupOperator,
} from "./rules/participation";
import type { GroupManagementCommand } from "./managementSchema";
import type { GroupManagement } from "./managementTypes";

export const defaultGroupManagement = (root: Corporation): GroupManagement => ({
  name: root.name,
  supplyPolicy: "independent",
  ...root.groupManagement,
});
export function groupOperator(c: Corporation, rootId: string): GroupOperator {
  return {
    id: c._id.toString(),
    rootId,
    ceoId: c.ceoId?.toString() ?? "",
    ceoTenureKey: JSON.stringify([
      c.ceoHistory?.length ?? 0,
      c.ceoHistory?.at(-1)?.startTurn ?? null,
      c.ceoHistory?.at(-1)?.endTurn ?? null,
    ]),
    userId: c.userId?.toString(),
    operator: c.ceoType === "npp" ? "npp" : "player",
    vacant: c.ceoVacant === true,
    stateOwned: !!c.countryOwnerId,
  };
}
export async function loadGroupManagement(db: Db, corporation: Corporation, userId: string) {
  const membership = await resolveFormalizedGroups(db, { includeReserved: true });
  const rootId = membership.rootByCorpId.get(corporation._id.toString());
  const ids = rootId ? membership.membersByRootId.get(rootId) : undefined;
  if (!rootId || !ids) return null;
  const [corps, world] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: ids.map((id) => new ObjectId(id)) } },
        {
          projection: {
            name: 1,
            sequentialId: 1,
            ceoId: 1,
            ceoHistory: 1,
            ceoType: 1,
            userId: 1,
            ceoVacant: 1,
            countryOwnerId: 1,
            groupManagement: 1,
            groupReceiving: 1,
            groupDirection: 1,
            logoUrl: 1,
            shareholders: 1,
            totalShares: 1,
            superShareMultiplier: 1,
            subsidiaryFormalizedAtTurn: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentTurn: 1, subsidiaryCorporationsEnabled: 1 } }
      ),
  ]);
  const root = corps.find((c) => c._id.toString() === rootId);
  if (!root) return null;
  const parent =
    world?.subsidiaryCorporationsEnabled === true &&
    !requireCeo(root, userId) &&
    root.ceoType !== "npp" &&
    !root.countryOwnerId &&
    root.subsidiaryFormalizedAtTurn == null;
  const turn = world?.currentTurn ?? 0;
  return { root, corps, turn, parent, enabled: world?.subsidiaryCorporationsEnabled === true };
}
export async function groupManagementView(db: Db, corporation: Corporation, userId: string) {
  const ctx = await loadGroupManagement(db, corporation, userId);
  if (!ctx) return null;
  const rootId = ctx.root._id.toString();
  const privateIds = ctx.corps
    .filter(
      (c) => ctx.parent || (!requireCeo(c, userId) && c.ceoType !== "npp" && !c.countryOwnerId)
    )
    .map((c) => c._id);
  const history = privateIds.length
    ? await db
        .collection<CorporationHistory>("corporationHistory")
        .find(
          {
            corporationId: { $in: privateIds },
            turn: { $gte: Math.max(0, ctx.turn - 48), $lte: ctx.turn },
          },
          {
            projection: {
              corporationId: 1,
              turn: 1,
              revenue: 1,
              totalCosts: 1,
              income: 1,
              currencyCode: 1,
              fxRateAtWrite: 1,
            },
          }
        )
        .sort({ turn: -1 })
        .limit(privateIds.length * 49)
        .toArray()
    : [];
  const historyByCorp = new Map<string, NonNullable<ReturnType<typeof groupHistoryInAnchor>>[]>();
  for (const row of history) {
    const converted = groupHistoryInAnchor(row);
    if (!converted) continue;
    const key = row.corporationId.toString(),
      rows = historyByCorp.get(key) ?? [];
    rows.push(converted);
    historyByCorp.set(key, rows);
  }
  return {
    rootId,
    settings: defaultGroupManagement(ctx.root),
    currentTurn: ctx.turn,
    canManage: ctx.parent,
    managementEnabled: ctx.enabled,
    /** No economic activation is implied by saving a direction or participation preference. */
    supplyEngineEnabled: false,
    members: ctx.corps.map((c) => {
      const own = !requireCeo(c, userId) && c.ceoType !== "npp" && !c.countryOwnerId;
      const privateAccess = ctx.parent || own;
      const operator = groupOperator(c, rootId);
      const preference = c.groupReceiving;
      const validPreference =
        preference?.rootId === rootId &&
        preference.ceoId === operator.ceoId &&
        preference.ceoTenureKey === operator.ceoTenureKey &&
        preference.userId === operator.userId;
      const direction = c.groupDirection?.rootId === rootId ? c.groupDirection : undefined;
      return {
        id: c._id.toString(),
        pathId: String(c.sequentialId ?? c._id),
        name: c.name,
        logoUrl: c.logoUrl,
        history: privateAccess ? (historyByCorp.get(c._id.toString()) ?? []) : null,
        operator: operator.operator,
        isRoot: c._id.equals(ctx.root._id),
        canEdit: own && ctx.enabled,
        receiving: privateAccess ? effectiveGroupReceiving(operator, preference, ctx.turn) : null,
        requested:
          privateAccess && validPreference ? preference.enabled : privateAccess ? false : null,
        effectiveTurn: privateAccess && validPreference ? preference.effectiveTurn : null,
        direction: privateAccess ? direction : null,
      };
    }),
  };
}
export async function updateGroupManagement(
  db: Db,
  corporation: Corporation,
  userId: string,
  command: GroupManagementCommand
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const deny = (error: string, status = 403) => ({ ok: false as const, status, error });
  const paused = await requireCorporationActionsEnabled(db);
  if (paused) return deny("Corporation actions are paused.", 409);
  const ctx = await loadGroupManagement(db, corporation, userId);
  if (!ctx || !ctx.enabled) return deny("Subsidiary group management is unavailable.", 409);
  const rootId = ctx.root._id.toString(),
    now = new Date();
  const own =
    !requireCeo(corporation, userId) &&
    corporation.ceoType !== "npp" &&
    !corporation.countryOwnerId;
  if (command.action === "participation") {
    if (!own) return deny("Only this corporation's player CEO can change receiving participation.");
    if (defaultGroupManagement(ctx.root).supplyPolicy !== "members")
      return deny("Apply Group members first before changing participation.", 409);
    const preference = scheduleGroupReceiving(
      groupOperator(corporation, rootId),
      corporation.groupReceiving,
      command.enabled,
      ctx.turn
    );
    const result = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        userId: new ObjectId(userId),
        ceoId: corporation.ceoId,
        ceoVacant: { $ne: true },
      },
      { $set: { groupReceiving: preference, updatedAt: now } }
    );
    return result.matchedCount
      ? { ok: true }
      : deny("The corporation's CEO changed. Refresh and try again.", 409);
  }
  if (command.action === "respond") {
    if (!own) return deny("Only this corporation's player CEO can respond.");
    const direction = corporation.groupDirection;
    if (
      !direction ||
      direction.rootId !== rootId ||
      direction.revision !== command.revision ||
      direction.ceoId !== corporation.ceoId?.toString()
    )
      return deny("This suggestion is no longer current.", 409);
    const result = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        userId: new ObjectId(userId),
        ceoId: corporation.ceoId,
        "groupDirection.revision": command.revision,
        "groupDirection.rootId": rootId,
      },
      { $set: { "groupDirection.response": command.response, updatedAt: now } }
    );
    return result.matchedCount
      ? { ok: true }
      : deny("The suggestion changed. Refresh and try again.", 409);
  }
  if (!ctx.parent) return deny("Only the parent corporation's player CEO can manage the group.");
  if (command.action === "direction") {
    const target = ctx.corps.find((c) => c._id.toString() === command.memberId);
    if (!target || target._id.equals(ctx.root._id))
      return deny("Choose a current subsidiary.", 400);
    if (!(await canActOnCorporationAsParent(db, new ObjectId(userId), target)))
      return deny("You no longer control this subsidiary.");
    const result = await db.collection<Corporation>("corporations").updateOne(
      { _id: target._id, ceoId: target.ceoId, subsidiaryFormalizedAtTurn: { $exists: true } },
      {
        $set: {
          groupDirection: {
            revision: randomUUID(),
            rootId,
            objective: command.objective,
            regions: [...new Set(command.regions)],
            allowInvestment: command.allowInvestment,
            setTurn: ctx.turn,
            response: "pending",
            ceoId: target.ceoId?.toString() ?? "",
          },
          updatedAt: now,
        },
      }
    );
    return result.matchedCount
      ? { ok: true }
      : deny("The subsidiary changed. Refresh and try again.", 409);
  }
  const update =
    command.action === "identity"
      ? { "groupManagement.name": command.name }
      : { "groupManagement.supplyPolicy": command.policy };
  const result = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: ctx.root._id,
      userId: new ObjectId(userId),
      ceoId: ctx.root.ceoId,
      ceoVacant: { $ne: true },
    },
    { $set: { ...update, updatedAt: now } }
  );
  return result.matchedCount
    ? { ok: true }
    : deny("The parent CEO changed. Refresh and try again.", 409);
}
