import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import {
  parseAndVerifyPatreonWebhook,
  getPatreonUserIdFromPayload,
  getPrimaryPatreonTierId,
} from "@/lib/patreon/webhook";
import {
  applyPatreonStatus,
  findUserByPatreonUserId,
  mapPatreonTierId,
  startPatreonGracePeriod,
} from "@/lib/patreon/service";

const ACTIVE_EVENTS = new Set([
  "pledge:create",
  "pledge:update",
  "members:create",
  "members:update",
]);
const CANCEL_EVENTS = new Set(["pledge:delete", "members:delete"]);

export async function POST(request: Request) {
  try {
    const { eventType, payload } = await parseAndVerifyPatreonWebhook(request);
    const patreonUserId = getPatreonUserIdFromPayload(payload);

    if (!patreonUserId) {
      return NextResponse.json({ ok: true, ignored: "missing_patreon_user_id" }, { status: 202 });
    }

    const db = await getDb();
    const user = await findUserByPatreonUserId(db, patreonUserId);
    if (!user) {
      return NextResponse.json({ ok: true, ignored: "unlinked_patreon_user" }, { status: 202 });
    }

    if (ACTIVE_EVENTS.has(eventType)) {
      const tier = mapPatreonTierId(getPrimaryPatreonTierId(payload));
      await applyPatreonStatus(db, {
        userId: user._id,
        tier,
        expiresAt: null,
        adsDisabledDefault: true,
        patreonUserId,
      });
      return NextResponse.json({ ok: true, status: "active" });
    }

    if (CANCEL_EVENTS.has(eventType)) {
      await startPatreonGracePeriod(db, user._id);
      return NextResponse.json({ ok: true, status: "grace_period" });
    }

    return NextResponse.json({ ok: true, ignored: "unsupported_event" }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
