import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { CharacterRecap } from "@/lib/recap/types";
import { getSiteUrl } from "@/lib/siteMetadata";
import { WrappedShareView } from "@/components/recap/WrappedShareView";

export const dynamic = "force-dynamic";

/**
 * Public shareable recap page. Reads the frozen recap straight from
 * `retiredCharacters` by characterId (no auth, no ownership check — the point is
 * that a shared link works for anyone), and unfurls via the sibling
 * opengraph-image route. Reachable during maintenance (see MAINTENANCE_BYPASS
 * + character-gate allowlist for `/wrapped`).
 */
async function loadRecap(characterId: string): Promise<CharacterRecap | null> {
  if (!ObjectId.isValid(characterId)) return null;
  const db = await getDb();
  const doc = await db
    .collection<RetiredCharacter>("retiredCharacters")
    .findOne(
      { characterId: new ObjectId(characterId), recap: { $exists: true } },
      { sort: { retiredAt: -1 }, projection: { recap: 1 } }
    );
  return doc?.recap ?? null;
}

type Props = { params: Promise<{ characterId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { characterId } = await params;
  const recap = await loadRecap(characterId);
  if (!recap) return { title: "Season Wrapped | A House Divided" };

  const season = recap.iteration ? `${recap.iteration.type} ${recap.iteration.number}` : "Season";
  const title = `${recap.name}'s ${season} Wrapped`;
  const bits = [
    recap.highestOffice,
    recap.actions.total > 0 ? `${recap.actions.total.toLocaleString("en-US")} actions` : null,
    recap.achievements.count > 0 ? `${recap.achievements.count} achievements` : null,
  ].filter(Boolean);
  const description = `${bits.join(" · ")} — a season in A House Divided.`;
  const url = `${getSiteUrl()}/wrapped/${recap.characterId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function WrappedPage({ params }: Props) {
  const { characterId } = await params;
  const recap = await loadRecap(characterId);
  if (!recap) notFound();
  return <WrappedShareView recap={recap} />;
}
