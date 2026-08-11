import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CabinetNomination } from "@/lib/db/types";
import { getCabinetPositionById } from "@/lib/constants";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const nomination = await db
    .collection<CabinetNomination>("cabinetNominations")
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { positionId: 1, nomineeCharacterName: 1, nomineeParty: 1, status: 1 } }
    );
  if (!nomination) return {};

  const pos = getCabinetPositionById(nomination.positionId);
  const positionName = pos?.name ?? nomination.positionId;
  const title = `${nomination.nomineeCharacterName} — ${positionName} nomination | A House Divided`;
  const description = `Cabinet nomination of ${nomination.nomineeCharacterName}${nomination.nomineeParty ? ` (${nomination.nomineeParty})` : ""} for ${positionName}. Status: ${nomination.status}.`;
  const url = `${getSiteUrl()}/congress/nominations/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: { card: "summary", title, description, images: [CDN_LOGO_URL] },
  };
}

export default function NominationLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
