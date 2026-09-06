import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";
import { WorldsimPageClient } from "./WorldsimPageClient";

export const dynamic = "force-dynamic";

export default async function WorldsimPage() {
  if (!isSingleplayer()) notFound();
  const config = await getSingleplayerConfig(await getDb());
  if (config?.mode !== "worldsim") notFound();
  return <WorldsimPageClient />;
}
