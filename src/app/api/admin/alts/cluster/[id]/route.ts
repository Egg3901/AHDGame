// GET /api/admin/alts/cluster/[id] — one cluster's full explainable detail
// Auth: requireModerator (mods and admins both read; plan §4.6)
// Errors: 400, 401, 403, 404
//
// Frozen contract (forensics/alt-detection rework plan §4.9):
//   GET /api/admin/alts/cluster/:id
//     -> { id, confidence, size, status, members:[{userId,name(masked?),banned,role}],
//          signalSummary, contributions:[{type,weight,contribution,evidence}],
//          links:[{userA,userB,confidence,signals[]}], topEvidence[] }
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getAltClustersCollection, getAltLinksCollection } from "@/lib/db/collections";
import type {
  AltCluster,
  AltClusterStatus,
  AltLinkSignal,
  AltSignal,
} from "@/lib/db/types/altDetection";
import type { User } from "@/lib/db/types";
import { memberRole, redactEvidenceForRole } from "../../_shared";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid cluster id" }, { status: 400 });
    }

    const db = await getDb();
    const clustersCol = await getAltClustersCollection(db);
    const cluster = await clustersCol.findOne({ _id: new ObjectId(id) });
    if (!cluster) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    const isAdmin = auth.user.isAdmin === true;
    const memberIds = cluster.memberUserIds;
    const memberIdStrs = memberIds.map((mid) => mid.toString());

    const [users, linksCol] = await Promise.all([
      memberIds.length
        ? db
            .collection<User>("users")
            .find({ _id: { $in: memberIds } }, { projection: { username: 1, isBanned: 1 } })
            .toArray()
        : Promise.resolve([]),
      getAltLinksCollection(db),
    ]);
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    // Internal edges: both endpoints are members of this cluster. These are
    // the edges the cluster was built from (plus any below-threshold weak
    // edges also captured between the same pair).
    const memberIdSet = new Set(memberIdStrs);
    const clusterLinks = memberIds.length
      ? await linksCol.find({ userA: { $in: memberIds }, userB: { $in: memberIds } }).toArray()
      : [];
    const internalLinks = clusterLinks.filter(
      (link) => memberIdSet.has(link.userA.toString()) && memberIdSet.has(link.userB.toString())
    );

    const members = memberIds.map((mid) => {
      const idStr = mid.toString();
      const u = userById.get(idStr);
      return {
        userId: idStr,
        name: u?.username ?? null,
        banned: u?.isBanned ?? false,
        role: memberRole(idStr, cluster.roles),
      };
    });

    // Aggregate per-signal-type "contributions" across the cluster's
    // internal links: the strongest (highest-contribution) instance of each
    // signal type stands in for the type's representative weight/evidence,
    // mirroring how `buildSignalSummary`/`buildTopEvidence`
    // (`src/lib/altDetection/cluster.ts`) pick the strongest evidence per
    // type. `signalSummary` (count/maxContribution) is returned separately,
    // unmodified from the stored doc.
    const bestByType = new Map<AltSignal, AltLinkSignal>();
    for (const link of internalLinks) {
      for (const signal of link.signals) {
        if (signal.weight <= 0) continue;
        const existing = bestByType.get(signal.type);
        if (!existing || signal.contribution > existing.contribution) {
          bestByType.set(signal.type, signal);
        }
      }
    }
    const contributions = [...bestByType.values()]
      .sort((a, b) => b.contribution - a.contribution)
      .map((signal) => ({
        type: signal.type,
        weight: signal.weight,
        contribution: signal.contribution,
        evidence: redactEvidenceForRole(signal.evidence, isAdmin),
      }));

    const links = internalLinks.map((link) => ({
      userA: link.userA.toString(),
      userB: link.userB.toString(),
      confidence: link.confidence,
      signals: link.signals.map((signal) => ({
        type: signal.type,
        weight: signal.weight,
        contribution: signal.contribution,
        evidence: redactEvidenceForRole(signal.evidence, isAdmin),
      })),
    }));

    const topEvidence = cluster.topEvidence.map((evidence) =>
      redactEvidenceForRole(evidence, isAdmin)
    );

    return NextResponse.json({
      id: cluster._id.toString(),
      confidence: cluster.confidence,
      size: cluster.size,
      status: cluster.status,
      members,
      signalSummary: cluster.signalSummary,
      contributions,
      links,
      topEvidence,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/alts/cluster/[id] — moderator/admin disposition of a cluster.
// Auth: requireModerator to review/dismiss/reopen; marking "confirmed" is admin-only (plan §4.6).
// Body: { status: "open"|"reviewed"|"confirmed"|"dismissed", note?: string }
const MOD_STATUSES = new Set<AltClusterStatus>(["open", "reviewed", "dismissed"]);
const ADMIN_ONLY_STATUSES = new Set<AltClusterStatus>(["confirmed"]);

const patchBodySchema = z.object({
  status: z.string().optional(),
  note: z.string().optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid cluster id" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, patchBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const status = body.status as AltClusterStatus;
    const isAdmin = auth.user.isAdmin === true;
    if (!MOD_STATUSES.has(status) && !ADMIN_ONLY_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (ADMIN_ONLY_STATUSES.has(status) && !isAdmin) {
      return NextResponse.json({ error: "Admin required to confirm a cluster" }, { status: 403 });
    }

    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 1000)
        : undefined;

    const db = await getDb();
    const clustersCol = await getAltClustersCollection(db);
    const set: Partial<Pick<AltCluster, "status" | "reviewedBy" | "reviewNote" | "updatedAt">> = {
      status,
      reviewedBy: new ObjectId(auth.user.userId),
      updatedAt: new Date(),
    };
    if (note !== undefined) set.reviewNote = note;
    const updated = await clustersCol.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: set },
      { returnDocument: "after" }
    );
    if (!updated) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated._id.toString(),
      status: updated.status,
      reviewedBy: updated.reviewedBy?.toString() ?? null,
      reviewNote: updated.reviewNote ?? null,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
