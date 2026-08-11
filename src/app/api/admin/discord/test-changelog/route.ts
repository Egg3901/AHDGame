import { NextResponse } from "next/server";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { postLatestChangelog, postChangelogUpdates } from "@/lib/discordChangelog";
import { z } from "zod";

const schema = z.object({
  /** "latest" sends the most recent version in full; "updates" sends only new/changed content */
  mode: z.enum(["latest", "updates"]).default("latest"),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    if (parsed.data.mode === "latest") {
      const result = await postLatestChangelog();
      return NextResponse.json({
        success: true,
        version: result.version,
        embeds: result.embeds,
      });
    }

    const result = await postChangelogUpdates();
    return NextResponse.json({
      success: true,
      sent: result.sent,
      skipped: result.skipped,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
