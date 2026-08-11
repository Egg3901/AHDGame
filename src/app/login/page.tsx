import LoginPageClient from "./LoginPageClient";
import { isMissingRequiredEnvError } from "@/lib/env";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { getEraConfig } from "@/components/landing/eraThemes";
import { getLoginImage } from "@/lib/images/staticCdnAssets";

export default async function LoginPage() {
  let maintenanceMode = false;
  let wireframeColor: string | undefined;
  let eraLabel: string | undefined;
  let eraTagline: string | undefined;
  let loginImageUrl: string | undefined;

  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { maintenanceMode: 1, seedYear: 1 } });

    // The login page only ever needs "is maintenance active at all" — no
    // partial-specific copy here (see MaintenanceModePanel for the admin
    // toggle, MaintenancePartialBanner for the player-facing partial notice).
    maintenanceMode = normalizeMaintenanceMode(config?.maintenanceMode) !== "off";
    const eraConfig = getEraConfig(config?.seedYear ?? 1979);
    wireframeColor = eraConfig.wireframeColor ?? undefined;
    eraLabel = eraConfig.label;
    eraTagline = eraConfig.loginTagline;
    // Pass image only when an era-specific file is on the CDN (wireframe eras render it ghosted behind scanlines)
    // Fallback to Lincoln memorial for unknown/missing seedYear so production worlds seeded before
    // the era system don't get a broken CRT wireframe login.
    loginImageUrl = getLoginImage(eraConfig.year);
  } catch (error) {
    if (!isMissingRequiredEnvError(error)) {
      console.error("Failed to load login page config:", error);
    }
  }

  return (
    <LoginPageClient
      initialMaintenanceMode={maintenanceMode}
      wireframeColor={wireframeColor}
      eraLabel={eraLabel}
      eraTagline={eraTagline}
      loginImageUrl={loginImageUrl}
    />
  );
}
