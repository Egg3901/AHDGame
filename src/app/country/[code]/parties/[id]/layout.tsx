import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string; id: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}): Promise<Metadata> {
  const { code, id } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};
  const sequentialId = Number(id);
  if (!Number.isFinite(sequentialId)) return {};

  const db = await getDb();
  if (!(await isCountryEnabledForPlayers(db, countryId))) return {};
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { sequentialId, countryId },
      { projection: { name: 1, abbreviation: 1, logoUrl: 1, heroImageUrl: 1 } }
    );
  if (!party) return {};

  const title = `${party.name} | A House Divided`;
  const description = `${party.abbreviation ? `${party.abbreviation} · ` : ""}${party.name} — political party in ${countryId}. Members, platform, finances, and leadership.`;
  const url = `${getSiteUrl()}/country/${code}/parties/${id}`;
  const image = party.logoUrl || party.heroImageUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: image, width: 512, height: 512, alt: party.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default function CountryPartyLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
