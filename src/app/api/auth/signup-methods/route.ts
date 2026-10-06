import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { isAppleSignInConfigured } from "@/lib/auth/apple";

/**
 * Which ways of signing up actually work on THIS deployment.
 *
 * The register page used to render "Register with Discord" and "Register with
 * Google" unconditionally under copy promising an instant account. On a server
 * with no OAuth credentials, or with test mode on (which hard-blocks new
 * Discord registrations with no test-secret escape hatch), both buttons were
 * dead: one bounced to a login page, the other to an error result. Asking the
 * server up front lets the page disable what does not work and say why, instead
 * of sending the player through a redirect to find out.
 */
export interface SignupMethods {
  testMode: boolean;
  /** Email + password. Requires the test secret while `testMode` is on. */
  email: { available: true; requiresTestSecret: boolean };
  discord: { available: boolean; reason: "not_configured" | "test_mode" | null };
  google: { available: boolean; reason: "not_configured" | "test_mode" | null };
  apple: { available: boolean; reason: "not_configured" | "test_mode" | null };
}

// GET /api/auth/signup-methods — Which registration methods this deployment supports.
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { testMode: 1 } });
    const testMode = config?.testMode === true;

    const discordConfigured = Boolean(
      process.env.DISCORD_CLIENT_ID && process.env.DISCORD_REDIRECT_URI
    );
    const googleConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REDIRECT_URI
    );

    const appleConfigured = isAppleSignInConfigured();

    const body: SignupMethods = {
      testMode,
      email: { available: true, requiresTestSecret: testMode },
      // Test mode blocks new OAuth registrations in every callback route, and
      // unlike email signup there is no secret-bearing path through them.
      discord: {
        available: discordConfigured && !testMode,
        reason: !discordConfigured ? "not_configured" : testMode ? "test_mode" : null,
      },
      google: {
        available: googleConfigured && !testMode,
        reason: !googleConfigured ? "not_configured" : testMode ? "test_mode" : null,
      },
      apple: {
        available: appleConfigured && !testMode,
        reason: !appleConfigured ? "not_configured" : testMode ? "test_mode" : null,
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    return handleRouteError(error);
  }
}
