/**
 * Mint a Playwright storage-state for the LOCAL dev server, so `ui-screenshot`
 * can reach authenticated routes.
 *
 * Signs the same JWT `POST /api/auth/login` does, for a user picked by
 * username, and writes it under the same per-environment cookie name. Local
 * only by construction: it reads MONGODB_URI (the testing database) and the
 * cookie name resolves to `auth-token-local` off the dev process's env, so the
 * artefact is useless against any deployed environment.
 *
 *   npx tsx scripts/debug/ui-auth-state.ts <username|character name> [out.json]
 */
import { MongoClient } from "mongodb";
import { SignJWT } from "jose";
import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { computeAuthCookieName } from "../../src/lib/authCookieName";

dotenv.config({ path: ".env.local" });

const username = process.argv[2];
const out = process.argv[3] ?? "tmp/ui-auth.json";
if (!username) {
  console.error("Usage: npx tsx scripts/debug/ui-auth-state.ts <username> [out.json]");
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const exact = { $regex: `^${username}$`, $options: "i" };
    // Accept a CHARACTER name too — that is what the status bar shows, so it is
    // what anyone reaching for this script will have to hand.
    let user = await db.collection("users").findOne({ username: exact });
    if (!user) {
      const character = await db.collection("characters").findOne({ name: exact });
      if (character?.userId) {
        user = await db.collection("users").findOne({ _id: character.userId });
      }
    }
    if (!user) throw new Error(`No user or character named ${username}`);

    const token = await new SignJWT({
      userId: user._id.toString(),
      email: user.email,
      username: user.username,
      role: user.role,
      isAdmin: user.isAdmin || false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(secret));

    // BOTH hosts. `ui-screenshot`'s reachability probe uses Node fetch, which
    // resolves `localhost` to ::1 on this box while the dev server listens on
    // 127.0.0.1 — so captures run against the IPv4 literal, and a cookie scoped
    // to `localhost` alone is silently not sent. The page then renders its
    // logged-out state and the review screenshots a shell.
    const state = {
      cookies: ["localhost", "127.0.0.1"].map((domain) => ({
        name: computeAuthCookieName(),
        value: token,
        domain,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      })),
      // Pre-accept the cookie banner. It is a fixed overlay that sits over the
      // bottom third of a 375px viewport, so without this every mobile review
      // screenshot is read around a modal that has nothing to do with the
      // surface under review.
      origins: ["http://localhost:3000", "http://127.0.0.1:3000"].map((origin) => ({
        origin,
        localStorage: [{ name: "ahd-cookie-consent", value: "accepted" }],
      })),
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(state, null, 2));
    console.log(`Wrote ${out} for ${user.username} (${computeAuthCookieName()})`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
