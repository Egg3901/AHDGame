import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import { singleplayerStatus } from "@/lib/singleplayerServer";

export const dynamic = "force-dynamic";

/** Old Control Room bookmarks return to the game. Native setup owns world rules. */
export default async function SingleplayerAdminPage() {
  if (!isSingleplayer()) notFound();
  const status = await singleplayerStatus(await getDb());
  redirect(
    status.mode === "worldsim"
      ? status.spectatorPath
      : status.hasCharacter
        ? "/profile"
        : "/create-character"
  );
}
