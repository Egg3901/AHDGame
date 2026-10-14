import Link from "next/link";
import { redirect } from "next/navigation";
import { isMissingRequiredEnvError } from "@/lib/env";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { computeIntakeStatus, type IntakeStatus } from "@/lib/auth/intakeStatus";
import { getEraConfig } from "@/components/landing/eraThemes";
import { getLoginImage } from "@/lib/images/staticCdnAssets";
import { IntakeClosedPanel } from "@/components/intake/IntakeClosedPanel";
import RegisterPageClient from "./RegisterPageClient";

export default async function RegisterPage() {
  // The signup hero must match the world the player is signing up to. This is
  // a server component that already touches the DB, so it reads `seedYear` the
  // same way `src/app/login/page.tsx` does rather than hardcoding a hero in the
  // client. Falls back to the Lincoln memorial via `getLoginImage` when the
  // seed year is unknown (worlds seeded before the era system).
  let heroImageUrl: string | undefined;
  let intake: IntakeStatus | null = null;

  try {
    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          maintenanceMode: 1,
          registrationEnabled: 1,
          maintenanceExpectedEnd: 1,
          seedYear: 1,
        },
      }
    );
    heroImageUrl = getLoginImage(getEraConfig(config?.seedYear ?? 1979).year);
    intake = computeIntakeStatus(config);
  } catch (error) {
    if (!isMissingRequiredEnvError(error)) {
      console.error("Failed to load register intake state:", error);
    }
    // On DB error, allow through: POST /api/auth/register still enforces the gate.
  }

  // Full maintenance seals the whole site behind /maintenance.
  if (intake?.maintenanceMode === "full") redirect("/maintenance");

  // Any other closed state shows why up front, instead of a form that is
  // refused only after the player has filled it in and passed the challenge.
  if (intake && !intake.registration.open) {
    return (
      <IntakeClosedPanel
        surface="register"
        reason={intake.registration.reason}
        title="Sign-ups are paused"
        expectedEnd={intake.expectedEnd}
        body={
          intake.registration.reason === "maintenance" ? (
            <p>
              New accounts are paused during a short maintenance window. Check back when it ends, or
              join Discord to hear the moment sign-ups reopen.
            </p>
          ) : (
            <p>
              We are not taking new accounts right now. Join Discord to hear the moment sign-ups
              reopen.
            </p>
          )
        }
        actions={
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-card-border bg-card px-5 text-sm font-medium transition-all hover:bg-card-elevated"
          >
            I already have an account
          </Link>
        }
      />
    );
  }

  return <RegisterPageClient heroImageUrl={heroImageUrl} />;
}
