import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

const truncate = (s: string | undefined | null, max = 200) =>
  !s ? "" : s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const retired = await db
    .collection<RetiredCharacter>("retiredCharacters")
    .findOne({ _id: new ObjectId(id) }, { projection: { snapshot: 1 } });
  if (!retired?.snapshot) return {};

  const s = retired.snapshot;
  const title = `${s.name} (Retired) | A House Divided`;
  const description =
    truncate(s.bio) ||
    `${s.name}${s.partyName ? ` · ${s.partyName}` : ""}${s.homeState ? ` · ${s.homeState}` : ""}. Career history and achievements.`;
  const url = `${getSiteUrl()}/retired/${id}`;
  const image = s.avatarUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "profile",
      url,
      images: [{ url: image, width: 512, height: 512, alt: s.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default function RetiredLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
