import { getDb } from "@/lib/mongodb";
import { createNotification } from "@/lib/notifications";
import type { User } from "@/lib/db/types";

/**
 * Fan out a `wiki_submission_pending` notification to every moderator and
 * admin so the review queue doesn't sit idle. Called from the POST /api/wiki
 * route and the player/corp/party claim endpoints.
 */
export async function notifyModeratorsOfWikiSubmission(opts: {
  slug: string;
  title: string;
  submitterName: string;
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
        type: "wiki_submission_pending",
        title: "New wiki submission",
        message: `${opts.submitterName} submitted "${opts.title}" for review.`,
        metadata: { slug: opts.slug, href: "/moderator?tab=content&sub=wiki-review" },
      })
    )
  );
}

export async function notifySubmitterOfWikiDecision(opts: {
  submitterId: import("mongodb").ObjectId;
  slug: string;
  title: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<void> {
  const isApproved = opts.decision === "approved";
  await createNotification({
    userId: opts.submitterId,
    type: isApproved ? "wiki_submission_approved" : "wiki_submission_rejected",
    title: isApproved ? "Wiki page approved" : "Wiki page needs changes",
    message: isApproved
      ? `"${opts.title}" is now live in the wiki.`
      : `"${opts.title}" was returned for revision.${opts.reason ? ` Reason: ${opts.reason}` : ""}`,
    metadata: {
      slug: opts.slug,
      href: isApproved ? `/wiki/${opts.slug}` : `/wiki/${opts.slug}/edit`,
    },
  });
}
