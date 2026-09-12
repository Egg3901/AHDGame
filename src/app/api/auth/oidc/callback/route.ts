import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { issueUnifiedGameSession } from "@/lib/auth/unifiedGameSession";
import { getDb } from "@/lib/mongodb";

function cohortSourceForSubject(subject: string): string | null {
  try {
    const values = Object.entries(JSON.parse(process.env.AHD_UNIFIED_COHORT_TARGETS ?? "{}")) as [
      string,
      { userId?: string },
    ][];
    return values.find(([, target]) => target.userId === subject)?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const issuer = process.env.UNIFIED_OIDC_ISSUER;
  const clientId = process.env.UNIFIED_OIDC_CLIENT_ID;
  const clientSecret = process.env.UNIFIED_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.UNIFIED_OIDC_REDIRECT_URI;
  if (
    process.env.UNIFIED_OIDC_ENABLED !== "true" ||
    !issuer ||
    !clientId ||
    !clientSecret ||
    !redirectUri
  ) {
    return NextResponse.redirect(new URL("/login?error=unified_unavailable", request.url));
  }
  const appOrigin = new URL(redirectUri).origin;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  if (!code || !state)
    return NextResponse.redirect(new URL("/login?error=unified_state", appOrigin));
  const db = await getDb();
  const flow = await db
    .collection<{
      _id: string;
      state: string;
      nonce: string;
      verifier: string;
      expiresAt: Date;
    }>("unifiedOidcFlows")
    .findOneAndDelete({ state, expiresAt: { $gt: new Date() } });
  if (!flow) return NextResponse.redirect(new URL("/login?error=unified_state", appOrigin));
  const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: String(flow.verifier),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!tokenResponse.ok)
    return NextResponse.redirect(new URL("/login?error=unified_exchange", appOrigin));
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token)
    return NextResponse.redirect(new URL("/login?error=unified_exchange", appOrigin));
  const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer,
    audience: clientId,
    requiredClaims: ["sub", "nonce", "exp", "iat"],
  });
  if (payload.nonce !== flow.nonce || typeof payload.sub !== "string")
    return NextResponse.redirect(new URL("/login?error=unified_identity", appOrigin));
  const sourceId = cohortSourceForSubject(payload.sub);
  if (!sourceId || !ObjectId.isValid(sourceId))
    return NextResponse.redirect(new URL("/login?error=unified_cohort", appOrigin));
  const user = await db.collection("users").findOne({
    _id: new ObjectId(sourceId),
    "authMigrationFence.canonicalAccountId": { $exists: true },
    isBanned: { $ne: true },
  });
  if (!user) return NextResponse.redirect(new URL("/login?error=unified_identity", appOrigin));
  await issueUnifiedGameSession({ db, cookieStore, sourceId, issuerSubject: payload.sub, user });
  return NextResponse.redirect(new URL("/", appOrigin));
}
