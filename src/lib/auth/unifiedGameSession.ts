import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { Db } from "mongodb";
import { getAuthCookieOptions, getJwtSecret } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";

type CookieStore = Readonly<{
  set(name: string, value: string, options: Awaited<ReturnType<typeof getAuthCookieOptions>>): void;
}>;

type UnifiedGameUser = Readonly<Record<string, unknown>>;

export async function issueUnifiedGameSession(input: {
  db: Db;
  cookieStore: CookieStore;
  sourceId: string;
  issuerSubject: string;
  user: UnifiedGameUser;
}) {
  const email = typeof input.user.email === "string" ? input.user.email : undefined;
  const username = typeof input.user.username === "string" ? input.user.username : undefined;
  const displayName =
    typeof input.user.displayName === "string" ? input.user.displayName : undefined;
  const role = typeof input.user.role === "string" ? input.user.role : undefined;
  const isAdmin = input.user.isAdmin === true;
  const hasCompletedSetup = input.user.hasCompletedSetup !== false;
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const sessions = input.db.collection<{
    _id: string;
    userId: string;
    issuerSubject: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  }>("unifiedSessions");
  await sessions.insertOne({
    _id: sid,
    userId: input.sourceId,
    issuerSubject: input.issuerSubject,
    createdAt: new Date(),
    expiresAt,
    revokedAt: null,
  });
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const token = await new SignJWT({
    userId: input.sourceId,
    email,
    username,
    role,
    isAdmin,
    authSource: "unified",
    sid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime("7d")
    .sign(getJwtSecret());
  input.cookieStore.set(AUTH_COOKIE_NAME, token, await getAuthCookieOptions());
  return {
    id: input.sourceId,
    email,
    username,
    displayName,
    role,
    hasCompletedSetup,
    isAdmin,
  };
}
