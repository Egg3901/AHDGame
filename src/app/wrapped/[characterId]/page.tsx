import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { loadPublicRecap } from "@/lib/recap/loadPublicRecap";
import { getSiteUrl } from "@/lib/siteMetadata";
import { WrappedShareView } from "@/components/recap/WrappedShareView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ characterId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { characterId } = await params;
  const recap = await loadPublicRecap(characterId);
  if (!recap) return { title: "Season Wrapped | A House Divided" };

  const season = recap.iteration ? iterationLabel(recap.iteration) : "Season";
  const title = `${recap.name}'s ${season} Wrapped`;
  const bits = [
    recap.persona?.title,
    recap.highestOffice,
    recap.elections.entered > 0
      ? `${recap.elections.won} of ${recap.elections.entered} races won`
      : null,
    recap.actions.total > 0 ? `${recap.actions.total.toLocaleString("en-US")} actions` : null,
  ].filter(Boolean);
  const description = `${bits.join(" · ")}. A season in A House Divided.`;
  const url = `${getSiteUrl()}/wrapped/${recap.characterId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Public shareable recap page. Reads the frozen recap by characterId (no auth:
 * a shared link works for anyone) and unfurls via the sibling opengraph-image
 * route. Reachable during maintenance (MAINTENANCE_BYPASS + character-gate
 * allowlist for `/wrapped`).
 */
export default async function WrappedPage({ params }: Props) {
  const { characterId } = await params;
  const recap = await loadPublicRecap(characterId);
  if (!recap) notFound();
  return <WrappedShareView recap={recap} />;
}
