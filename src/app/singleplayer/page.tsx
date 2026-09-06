import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import { singleplayerStatus } from "@/lib/singleplayerServer";
import { SingleplayerHome } from "./SingleplayerHome";

export const dynamic = "force-dynamic";

/**
 * Where the launcher opens the browser. Continue the world that exists, or
 * start a new one from an era preset. Does not exist on a deployment.
 */
export default async function SingleplayerPage() {
  if (!isSingleplayer()) notFound();
  const status = await singleplayerStatus(await getDb());
  return <SingleplayerHome status={status} />;
}
