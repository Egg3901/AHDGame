import { NextResponse } from "next/server";
import { jwtVerify, errors as joseErrors } from "jose";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getJwtSecret } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { getDb } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";

const claimsSchema = z.object({
  userId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Read-only legacy session check. Consumers must pin the deployment origin. */
export async function GET(request: Request) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
    .map((part) => part.slice(AUTH_COOKIE_NAME.length + 1));
  const inactive = () => NextResponse.json({ active: false }, { status: 401, headers });
  // Never select between duplicate cookies or accept another deployment's cookie.
  if (values.length !== 1 || !values[0] || values[0].length > 8192) return inactive();

  try {
    let token: string;
    try {
      token = decodeURIComponent(values[0]);
    } catch {
      return inactive();
    }
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      requiredClaims: ["iat", "exp"],
    });
    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) return inactive();
    const { userId, iat, exp } = parsed.data;
    if (iat > Math.floor(Date.now() / 1000) + 60 || exp <= iat) return inactive();

    // Bypass the app's user cache: bans and revocation must be current here.
    const db = await getDb();
    const user = await db
      .collection<User>("users")
      .findOne(
        { _id: new ObjectId(userId) },
        { projection: { username: 1, isBanned: 1, authRevokedAt: 1 } }
      );
    if (!user || user.isBanned || !user.username) return inactive();
    if (user.authRevokedAt && user.authRevokedAt.getTime() >= iat * 1000) return inactive();

    // Identity only. Staff permissions and email ownership are separate checks.
    return NextResponse.json(
      { active: true, sub: user._id.toHexString(), username: user.username, iat, exp },
      { headers }
    );
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return inactive();
    // A dependency failure is not evidence that the browser session is invalid.
    return NextResponse.json({ error: "Session check unavailable" }, { status: 503, headers });
  }
}
