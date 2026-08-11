import { redirect } from "next/navigation";
import { isMissingRequiredEnvError } from "@/lib/env";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { getEraConfig } from "@/components/landing/eraThemes";
import { getLoginImage } from "@/lib/images/staticCdnAssets";
import RegisterPageClient from "./RegisterPageClient";

export default async function RegisterPage() {
  // The signup hero must match the world the player is signing up to. This is
  // a server component that already touches the DB, so it reads `seedYear` the
  // same way `src/app/login/page.tsx` does rather than hardcoding a hero in the
  // client. Falls back to the Lincoln memorial via `getLoginImage` when the
  // seed year is unknown (worlds seeded before the era system).
  let heroImageUrl: string | undefined;

  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { maintenanceMode: 1, seedYear: 1 } });
    heroImageUrl = getLoginImage(getEraConfig(config?.seedYear ?? 1979).year);
    // Only "full" redirects the page — "partial" renders normally; the
    // submit handler on RegisterPageClient still gets a 503 from the API
    // route (see POST /api/auth/register) so the user learns why it failed.
    if (normalizeMaintenanceMode(config?.maintenanceMode) === "full") {
      redirect("/maintenance");
    }
  } catch (error) {
    if (!isMissingRequiredEnvError(error)) {
      console.error("Failed to load register maintenance state:", error);
    }
    // On DB error, allow through — the API route will still block if maintenance is active
  }

  return <RegisterPageClient heroImageUrl={heroImageUrl} />;
}
