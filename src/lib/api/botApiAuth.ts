import crypto from "crypto";
import { getDb } from "@/lib/mongodb";

export type BotApiScope = "campaign" | "full";
export type BotApiSource = "env" | "user";

type BotApiAccessFailureReason = "missing" | "invalid" | "insufficient_scope";

export type BotApiAccessFailure = {
  ok: false;
  reason: BotApiAccessFailureReason;
};

export type BotApiAccessSuccess = {
  ok: true;
  source: BotApiSource;
  scope: BotApiScope;
  keyId: string;
  ownerUserId?: string;
};

export type BotApiAccessResult = BotApiAccessFailure | BotApiAccessSuccess;

function isBotApiScope(value: unknown): value is BotApiScope {
  return value === "campaign" || value === "full";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateBotApiToken(): { token: string; tokenHash: string; prefix: string } {
  const raw = crypto.randomBytes(24).toString("base64url");
  const token = `ahd_bot_${raw}`;
  return { token, tokenHash: hashToken(token), prefix: token.slice(0, 14) };
}

export async function requireBotApiAccess(
  request: Request,
  requiredScope: BotApiScope = "campaign"
): Promise<BotApiAccessResult> {
  const token = request.headers.get("X-Bot-Token");
  if (!token) return { ok: false as const, reason: "missing" };

  const privateKey = process.env.DISCORD_BOT_API_KEY;
  if (privateKey && token === privateKey) {
    return {
      ok: true as const,
      source: "env",
      scope: "full",
      keyId: "env:private",
    };
  }

  const publicKey = process.env.PUBLIC_BOT_API_KEY;
  if (publicKey && token === publicKey) {
    if (requiredScope === "full") return { ok: false as const, reason: "insufficient_scope" };
    return {
      ok: true as const,
      source: "env",
      scope: "campaign",
      keyId: "env:public",
    };
  }

  const db = await getDb();
  const keyDoc = await db
    .collection("botApiKeys")
    .findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!keyDoc) return { ok: false as const, reason: "invalid" };
  if (!isBotApiScope(keyDoc.scope)) {
    return { ok: false as const, reason: "invalid" };
  }

  if (requiredScope === "full" && keyDoc.scope !== "full") {
    return { ok: false as const, reason: "insufficient_scope" };
  }

  await db
    .collection("botApiKeys")
    .updateOne(
      { _id: keyDoc._id },
      { $set: { lastUsedAt: new Date(), updatedAt: new Date() }, $inc: { requestCount: 1 } }
    );

  return {
    ok: true as const,
    source: "user",
    scope: keyDoc.scope,
    keyId: String(keyDoc._id),
    ownerUserId: String(keyDoc.userId),
  };
}

export async function logBotApiRequest(params: {
  keyId: string;
  path: string;
  method: string;
  status: number;
  scope: BotApiScope;
  source: BotApiSource;
}) {
  const db = await getDb();
  await db.collection("botApiRequestLog").insertOne({ ...params, createdAt: new Date() });
}
