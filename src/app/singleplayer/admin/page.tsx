import { notFound, redirect } from "next/navigation";
import { getAuthAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import { getSingleplayerWorldAvailability } from "@/lib/singleplayerOperator";
import { singleplayerStatus } from "@/lib/singleplayerServer";
import { SingleplayerAdmin } from "./SingleplayerAdmin";

export const dynamic = "force-dynamic";

/**
 * Owner panel for a local world. The first local account owns the machine
 * (see @/lib/singleplayerOwnerAdmin), so the DB account record decides who
 * sees this panel. Anyone else returns to the game, like old bookmarks did.
 */
export default async function SingleplayerAdminPage() {
  if (!isSingleplayer()) notFound();
  const db = await getDb();
  const [status, mode] = await Promise.all([
    singleplayerStatus(db),
    getSingleplayerWorldAvailability(db),
  ]);
  // Status repairs owner-admin on pre-existing worlds with no admin yet, so
  // resolve the viewer only after it lands: a concurrent read could otherwise
  // bounce the owner back to the game on their first visit.
  const admin = await getAuthAdmin();
  if (!admin) {
    redirect(
      status.mode === "worldsim"
        ? status.spectatorPath
        : status.hasCharacter
          ? "/profile"
          : "/create-character"
    );
  }
  return (
    <SingleplayerAdmin status={status} initialAvailability={mode === "off" ? "open" : "sealed"} />
  );
}
