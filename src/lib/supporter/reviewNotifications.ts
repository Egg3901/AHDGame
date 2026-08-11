import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createNotification } from "@/lib/notifications";
import type { User } from "@/lib/db/types";
import type { SupporterRequestKind } from "@/lib/db/types/supporterRequests";

function kindLabel(kind: SupporterRequestKind): string {
  return kind === "wall-name" ? "supporter wall name" : "politician rename";
}

/**
 * Fan out a `supporter_request_pending` notification to every moderator and
 * admin so the supporter request queue does not sit idle. Mirrors the wiki
 * review notification fan-out.
 */
export async function notifyModeratorsOfSupporterRequest(opts: {
  kind: SupporterRequestKind;
  submitterName: string;
  summary: string;
}): Promise<void> {
  const db = await getDb();
  const mods = await db
    .collection<User>("users")
    .find({ $or: [{ role: "admin" }, { role: "moderator" }, { isAdmin: true }] })
    .project<{ _id: User["_id"] }>({ _id: 1 })
    .toArray();

  await Promise.all(
    mods.map((m) =>
      createNotification({
        userId: m._id,
        type: "supporter_request_pending",
        title: "New supporter request",
        message: `${opts.submitterName} submitted a ${kindLabel(opts.kind)} request: ${opts.summary}`,
        metadata: { kind: opts.kind, href: "/moderator?tab=content&sub=supporter-requests" },
      })
    )
  );
}

export async function notifySubmitterOfSupporterDecision(opts: {
  submitterId: ObjectId;
  kind: SupporterRequestKind;
  decision: "approved" | "rejected";
  summary: string;
  reason?: string;
}): Promise<void> {
  const isApproved = opts.decision === "approved";
  const label = kindLabel(opts.kind);
  await createNotification({
    userId: opts.submitterId,
    type: isApproved ? "supporter_request_approved" : "supporter_request_rejected",
    title: isApproved ? "Supporter request approved" : "Supporter request rejected",
    message: isApproved
      ? `Your ${label} request was approved: ${opts.summary}`
      : `Your ${label} request was rejected: ${opts.summary}${opts.reason ? ` Reason: ${opts.reason}` : ""}`,
    metadata: { kind: opts.kind, href: "/settings?section=supporter-perks" },
  });
}
