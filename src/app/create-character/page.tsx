import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { loadIntakeStatus, type IntakeStatus } from "@/lib/auth/intakeStatus";
import { IntakeClosedPanel } from "@/components/intake/IntakeClosedPanel";
import CreateCharacterClient from "./CreateCharacterClient";

export const dynamic = "force-dynamic";

/**
 * Server gate in front of the creation form. It settles the two questions the
 * form used to answer only after the player had filled it in: is this a real
 * session, and is character creation open right now.
 */
export default async function CreateCharacterPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login?returnUrl=" + encodeURIComponent("/create-character"));

  let intake: IntakeStatus | null = null;
  try {
    intake = await loadIntakeStatus(await getDb());
  } catch {
    // Fail open to the form: POST /api/auth/character still enforces the gate,
    // and the form now explains a closed response instead of failing silently.
  }

  // Admins bypass the maintenance gate on creation so they can check a freshly
  // reset world before reopening it, matching POST /api/auth/character.
  if (intake && !intake.characterCreation.open && !user.isAdmin) {
    return (
      <IntakeClosedPanel
        surface="create_character"
        reason={intake.characterCreation.reason}
        title="Your account is ready"
        expectedEnd={intake.expectedEnd}
        body={
          intake.maintenanceMode === "full" ? (
            <p>
              A new world is being prepared. Character creation opens when it starts, and your
              account is saved, so you can come straight back here.
            </p>
          ) : (
            <p>
              Character creation is paused for a short maintenance window. Your account is saved.
              Come back here when it ends and you can pick up where you left off.
            </p>
          )
        }
        actions={
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-card-border bg-card px-5 text-sm font-medium transition-all hover:bg-card-elevated"
          >
            Back to home
          </Link>
        }
      />
    );
  }

  return <CreateCharacterClient />;
}
