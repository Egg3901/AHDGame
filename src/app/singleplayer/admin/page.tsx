import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import { singleplayerStatus } from "@/lib/singleplayerServer";
import { getSingleplayerWorldAvailability } from "@/lib/singleplayerOperator";
import { SingleplayerAdmin } from "./SingleplayerAdmin";

export const dynamic = "force-dynamic";

export default async function SingleplayerAdminPage() {
  if (!isSingleplayer()) notFound();
  const db = await getDb();
  const [status, mode] = await Promise.all([
    singleplayerStatus(db),
    getSingleplayerWorldAvailability(db),
  ]);
  return (
    <SingleplayerAdmin status={status} initialAvailability={mode === "off" ? "open" : "sealed"} />
  );
}
