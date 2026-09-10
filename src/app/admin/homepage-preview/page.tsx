import { redirect } from "next/navigation";
import { getAuthAdmin } from "@/lib/auth";
import { buildGovernmentTypeMap } from "@/lib/landing/governmentTypeMap";
import { getMarketedWorldSafe } from "@/lib/marketing/marketedWorldServer";
import { HomepagePreviewClient } from "./HomepagePreviewClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Home Page Preview · Admin",
  description: "Admin-only preview of a redesigned, theme-aware landing page.",
};

/**
 * Admin-only preview of a redesigned public home page. Gated per-route via
 * getAuthAdmin() (no admin layout exists, so every admin page repeats the
 * guard). The page itself is a static, 1979-Cold-War-flavored design mock that
 * renders in whichever theme the signed-in admin has selected, so all 11
 * themes can be reviewed here. Not visible to players.
 */
export default async function HomepagePreviewPage() {
  const user = await getAuthAdmin();
  if (!user) {
    redirect("/dashboard");
  }

  // Static COUNTRY_CONFIGS defaults — preview doesn't need a live DB read.
  const governmentTypes = buildGovernmentTypeMap();
  // The version and playable roster DO come from the live world, so the preview
  // shows the same hero copy players see.
  const world = await getMarketedWorldSafe();

  return <HomepagePreviewClient governmentTypes={governmentTypes} world={world} />;
}
