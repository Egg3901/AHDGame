import type { Metadata } from "next";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import Link from "next/link";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { GameConfig, GameState } from "@/lib/db/types";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { CharacterRecap } from "@/lib/recap/types";
import { getAuthUser } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { MaintenanceCountdown } from "./MaintenanceCountdown";
import { MaintenanceRecapLauncher } from "./MaintenanceRecapLauncher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Maintenance | A House Divided",
  description:
    "A House Divided is temporarily unavailable while we perform maintenance. Check back shortly for updates to the live simulation.",
  pathname: "/maintenance",
});

export default async function MaintenancePage() {
  const db = await getDb();
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        maintenanceMode: 1,
        maintenanceReason: 1,
        maintenanceExpectedEnd: 1,
      },
    }
  );

  const reason = config?.maintenanceReason || "";
  const expectedEnd = config?.maintenanceExpectedEnd || "";

  // While the game is between iterations, a returning player can still log in
  // and relive their season. Fetch their most recent recap (if the feature is
  // on) so we can offer a re-watch here — the global SeasonRecapGate also
  // auto-opens it once on first login. Character creation stays blocked: this
  // page is the maintenance wall for every non-public route.
  let recap: CharacterRecap | null = null;
  try {
    const authUser = await getAuthUser();
    if (authUser) {
      const [gs, retired] = await Promise.all([
        db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { seasonRecapEnabled: 1 } }),
        db
          .collection<RetiredCharacter>("retiredCharacters")
          .findOne(
            { userId: new ObjectId(authUser.userId), recap: { $exists: true } },
            { sort: { retiredAt: -1 }, projection: { recap: 1 } }
          ),
      ]);
      if (gs?.seasonRecapEnabled === true && retired?.recap) recap = retired.recap;
    }
  } catch {
    // best-effort — never let the recap lookup break the maintenance wall
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-foreground">
      {/* Subtle top accent */}
      <div className="fixed inset-x-0 top-0 h-1 bg-gradient-to-r from-warning/80 via-warning/40 to-transparent" />

      <div className="w-full max-w-lg text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src={CDN_LOGO_URL}
              unoptimized
              alt="A House Divided"
              width={72}
              height={72}
              className="opacity-80 transition-opacity hover:opacity-100"
            />
          </Link>
        </div>

        {/* Wrench icon */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-warning/30 bg-warning/10">
            <svg
              className="h-8 w-8 text-warning"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h1 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
          {recap ? "Between iterations" : "Under Maintenance"}
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-muted sm:text-base">
          {recap
            ? "Your season has ended, and a fresh world is being prepared for the next iteration. New characters open when it begins — until then, relive your run below."
            : "A House Divided is currently down for scheduled maintenance. We’ll be back shortly."}
        </p>

        {recap && (
          <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Your Season, Wrapped
            </p>
            <MaintenanceRecapLauncher recap={recap} />
            {/* Only the newest recap is launched above; character history is the
                way to re-watch older characters' Wrapped, so link it directly
                (both /settings and /retired bypass the maintenance wall). */}
            <p className="text-xs text-muted">
              Also saved to your{" "}
              <Link
                href="/settings?section=retired-characters"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                character history
              </Link>
              .
            </p>
          </div>
        )}

        {/* Reason card */}
        {reason && (
          <div className="mb-6 rounded-xl border border-card-border bg-card p-5 text-left shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-0.5 rounded-full bg-warning" />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                Reason
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{reason}</p>
          </div>
        )}

        {/* Countdown */}
        {expectedEnd && <MaintenanceCountdown expectedEnd={expectedEnd} />}

        {/* Links */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-card-border bg-card px-5 text-sm font-medium transition-all hover:bg-card-elevated hover:border-muted/40"
          >
            Back to Home
          </Link>
          <a
            href="https://discord.gg/DmF8zJJuqN"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5865F2] px-5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
            </svg>
            Join Discord
          </a>
        </div>

        {/* Footer note */}
        <p className="mt-10 text-xs text-muted/60">
          A House Divided &mdash; Political Simulation Game
        </p>
      </div>
    </div>
  );
}
