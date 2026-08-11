import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { getSiteUrl } from "@/lib/siteMetadata";
import ImperialProfileClient from "./ImperialProfileClient";

const truncate = (s: string | undefined | null, max = 200) =>
  !s ? "" : s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sequentialId = Number(id);

  const db = await getDb();
  const projection = {
    name: 1,
    royalHouse: 1,
    countryId: 1,
    avatarUrl: 1,
    coatOfArmsUrl: 1,
    bio: 1,
  } as const;

  let imp: ImperialCharacter | null = null;
  if (Number.isFinite(sequentialId)) {
    imp = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ sequentialId }, { projection });
  }
  if (!imp && ObjectId.isValid(id)) {
    imp = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ _id: new ObjectId(id) }, { projection });
  }
  if (!imp) return {};

  const title = `${imp.name}${imp.royalHouse ? `, House of ${imp.royalHouse}` : ""} | A House Divided`;
  const description =
    truncate(imp.bio) ||
    `${imp.name}${imp.royalHouse ? ` of the House of ${imp.royalHouse}` : ""} · ${imp.countryId}. Imperial profile.`;
  const url = `${getSiteUrl()}/imperial/${id}`;
  const image = imp.avatarUrl || imp.coatOfArmsUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "profile",
      url,
      images: [{ url: image, width: 512, height: 512, alt: imp.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default async function ImperialProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImperialProfileClient id={id} />;
}
