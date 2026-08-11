// GET /api/admin/players/money-graph — money-flow graph for the forensics
// cockpit's cash-laundering-ring visualization (forensics v2 plan, Wave 1
// item 3). Nodes are accounts/entities (character/corporation/party seen as
// either side of a transfer, plus government/system leaves); edges are
// `financialTxLog` transfers aggregated by (from, to, currencyCode) within
// the requested turn window, expanded breadth-first from a center out to
// `depth` hops. Surfaces fan-in/fan-out and A->B->A round-trips.
//
// Auth: requireModerator (mods and admins both read, matching every other
// forensics/alt-detection read route — plan §4.6). Non-admins never see
// `admin_transfer` rows (mirrors `queryAuditLog`'s admin-category guard,
// the closest existing analog: raw admin cash adjustments are admin-only)
// and get node display names masked via `maskMoneyGraphName` (same
// truncate-with-ellipsis convention as `maskFingerprint`/`maskIp`). Node
// `id`s are never masked — they're needed to pivot into the per-account
// dossier regardless of role, same as `alts/cluster/[id]` never masking
// `userId`.
//
// Query params: `userId` (center) OR `clusterId` (center on every member's
// character), `depth` (1-2, default 1), `turnsBack` (default 168, matches
// `TX_TTL_TURNS`), `minAmount` (optional, filters both directions by
// absolute value).
//
// Response: { nodes:[{id, name, banned}], edges:[{from, to, totalAmount,
// txCount, currencyCode}], truncated, depth, turnMin, currentTurn }
//
// Errors: 400 (bad/missing params), 403 (not moderator/admin), 404 (userId
// has no character, or clusterId doesn't exist)
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getGameStateCollection } from "@/lib/db/collections";
import {
  buildMoneyGraph,
  annotateBannedFlags,
  resolveCentersForUser,
  resolveCentersForCluster,
  maskMoneyGraphName,
  MONEY_GRAPH_DEFAULT_TURNS_BACK,
  MONEY_GRAPH_MAX_TURNS_BACK,
  MONEY_GRAPH_MIN_DEPTH,
  MONEY_GRAPH_MAX_DEPTH,
} from "@/lib/audit/moneyGraph";

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const isAdmin = auth.user.isAdmin === true;

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get("userId");
    const clusterIdParam = searchParams.get("clusterId");
    const depthParam = searchParams.get("depth");
    const turnsBackParam = searchParams.get("turnsBack");
    const minAmountParam = searchParams.get("minAmount");

    if (!userIdParam && !clusterIdParam) {
      return NextResponse.json({ error: "userId or clusterId is required" }, { status: 400 });
    }
    if (userIdParam && clusterIdParam) {
      return NextResponse.json(
        { error: "Provide only one of userId or clusterId" },
        { status: 400 }
      );
    }
    if (userIdParam && !OBJECT_ID_RE.test(userIdParam)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    if (clusterIdParam && !OBJECT_ID_RE.test(clusterIdParam)) {
      return NextResponse.json({ error: "Invalid clusterId" }, { status: 400 });
    }

    let depth = MONEY_GRAPH_MIN_DEPTH;
    if (depthParam !== null) {
      const v = parseInt(depthParam, 10);
      if (!Number.isFinite(v) || v < MONEY_GRAPH_MIN_DEPTH || v > MONEY_GRAPH_MAX_DEPTH) {
        return NextResponse.json(
          { error: `depth must be between ${MONEY_GRAPH_MIN_DEPTH} and ${MONEY_GRAPH_MAX_DEPTH}` },
          { status: 400 }
        );
      }
      depth = v;
    }

    let turnsBack = MONEY_GRAPH_DEFAULT_TURNS_BACK;
    if (turnsBackParam !== null) {
      const v = parseInt(turnsBackParam, 10);
      if (!Number.isFinite(v) || v < 1 || v > MONEY_GRAPH_MAX_TURNS_BACK) {
        return NextResponse.json(
          { error: `turnsBack must be between 1 and ${MONEY_GRAPH_MAX_TURNS_BACK}` },
          { status: 400 }
        );
      }
      turnsBack = v;
    }

    let minAmount: number | undefined;
    if (minAmountParam !== null) {
      const v = parseFloat(minAmountParam);
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: "Invalid minAmount" }, { status: 400 });
      }
      minAmount = v;
    }

    const db = await getDb();

    let centerIds: ObjectId[];
    if (userIdParam) {
      centerIds = await resolveCentersForUser(db, new ObjectId(userIdParam));
      if (centerIds.length === 0) {
        return NextResponse.json({ error: "User has no character" }, { status: 404 });
      }
    } else {
      const { cluster, centers } = await resolveCentersForCluster(
        db,
        new ObjectId(clusterIdParam!)
      );
      if (!cluster) {
        return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
      }
      centerIds = centers;
      if (centerIds.length === 0) {
        return NextResponse.json({
          nodes: [],
          edges: [],
          truncated: false,
          depth,
          turnMin: 0,
          currentTurn: 0,
        });
      }
    }

    const gameStateCol = await getGameStateCollection(db);
    const gameState = await gameStateCol.findOne(
      { _id: "current" },
      { projection: { currentTurn: 1 } }
    );
    const currentTurn = gameState?.currentTurn ?? 0;
    const turnMin = Math.max(0, currentTurn - turnsBack);

    const result = await buildMoneyGraph(db, centerIds, { depth, turnMin, minAmount, isAdmin });
    await annotateBannedFlags(db, result.nodes);

    const nodes = result.nodes.map((node) => ({
      id: node.id,
      name: maskMoneyGraphName(node.name, node.type, isAdmin),
      banned: node.banned,
    }));

    return NextResponse.json({
      nodes,
      edges: result.edges,
      truncated: result.truncated,
      depth,
      turnMin,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
