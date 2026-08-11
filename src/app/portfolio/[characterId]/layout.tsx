import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character } from "@/lib/db/types/character";
import { getSiteUrl } from "@/lib/siteMetadata";
import { parseCharacterId } from "@/lib/utils/profileUrls";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ characterId: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ characterId: string }>;
}): Promise<Metadata> {
  const { characterId } = await params;
  const parsed = parseCharacterId(characterId);
  if (!parsed) return {};

  const db = await getDb();
  const projection = { name: 1, avatarUrl: 1 } as const;
  const character =
    parsed.type === "sequential"
      ? await db
          .collection<Character>("characters")
          .findOne({ sequentialId: parsed.value }, { projection })
      : ObjectId.isValid(parsed.value)
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: new ObjectId(parsed.value) }, { projection })
        : null;
  if (!character) return {};

  const title = `${character.name}'s Portfolio | A House Divided`;
  const description = `Stock holdings, bonds, and trading activity for ${character.name}.`;
  const url = `${getSiteUrl()}/portfolio/${characterId}`;
  const image = character.avatarUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "profile",
      url,
      images: [{ url: image, width: 512, height: 512, alt: character.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default function PortfolioCharacterLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
