import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { invalidatePollBannerCache } from "@/lib/pollBannerCache";
import {
  isSafePollBannerUrl,
  normalizePollBannerTone,
  POLL_BANNER_LINK_LABEL_MAX,
  POLL_BANNER_MESSAGE_MAX,
  POLL_BANNER_URL_MAX,
} from "@/lib/pollBanner";
import type { GameConfig } from "@/lib/db/types";

/**
 * The url is checked twice on purpose. The `.refine` below runs on ANY
 * non-empty url, enabled or not, so an unsafe scheme can never reach the
 * database even as a draft; the `superRefine` after it only demands that the
 * url and message be present when the banner is actually going live, which is
 * what lets an admin save a half-written draft with the toggle off.
 */
const patchSchema = z
  .object({
    enabled: z.boolean(),
    message: z.string().max(POLL_BANNER_MESSAGE_MAX),
    linkLabel: z.string().max(POLL_BANNER_LINK_LABEL_MAX),
    url: z
      .string()
      .max(POLL_BANNER_URL_MAX)
      .refine((value) => value.trim() === "" || isSafePollBannerUrl(value), {
        message: "Link must be an absolute http:// or https:// address",
      }),
    tone: z.enum(["info", "warning"]),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (!value.message.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "A message is required before the banner can be enabled",
      });
    }
    if (!value.url.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "A link is required before the banner can be enabled",
      });
    }
  });

// GET /api/admin/poll-banner - Fetch the stored poll banner draft and toggle.
// Auth: requireAdmin
// Errors: 403
/**
 * GET — the raw stored fields, including a draft the banner is not showing.
 *
 * Deliberately NOT `getCachedPollBanner`: that helper blanks everything out
 * while the toggle is off, which is right for the public endpoint and wrong
 * for the editor, where the admin needs their unfinished text back.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          pollBannerEnabled: 1,
          pollBannerMessage: 1,
          pollBannerLinkLabel: 1,
          pollBannerUrl: 1,
          pollBannerTone: 1,
          pollBannerUpdatedBy: 1,
          pollBannerUpdatedAt: 1,
        },
      }
    );

    return NextResponse.json({
      enabled: config?.pollBannerEnabled ?? false,
      message: config?.pollBannerMessage ?? "",
      linkLabel: config?.pollBannerLinkLabel ?? "",
      url: config?.pollBannerUrl ?? "",
      tone: normalizePollBannerTone(config?.pollBannerTone),
      updatedBy: config?.pollBannerUpdatedBy ?? "",
      updatedAt: config?.pollBannerUpdatedAt ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/poll-banner - Save the poll banner text, link, tone and toggle.
// Auth: requireAdmin
// Errors: 400, 403
/** PATCH — save the banner and flip it on or off */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { enabled, message, linkLabel, url, tone } = parsed.data;

    const db = await getDb();
    // No $unset on the "off" branch, unlike maintenance: switching the banner
    // off is routine and the same survey often goes back up, so the drafted
    // text and link are kept exactly as typed.
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          pollBannerEnabled: enabled,
          pollBannerMessage: message.trim(),
          pollBannerLinkLabel: linkLabel.trim(),
          pollBannerUrl: url.trim(),
          pollBannerTone: tone,
          pollBannerUpdatedBy: auth.admin.username,
          pollBannerUpdatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    invalidatePollBannerCache();

    await createAdminLog({
      category: "system",
      action: enabled ? "poll_banner_set" : "poll_banner_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? `Poll banner enabled (${tone}): "${message.trim()}" linking to ${url.trim()}`
        : "Poll banner disabled",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
