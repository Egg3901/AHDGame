import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import type { PoliticalParty } from "@/lib/db/types/party";
import { canonicalRegionId, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { getSiteUrl } from "@/lib/siteMetadata";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string; id: string; partyId: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; id: string; partyId: string }>;
}): Promise<Metadata> {
  const { code, id: regionId, partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};
  const sequentialId = Number(partyId);
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

  // Resolve the region's display name — the raw param may be a compact code
  // (BUD) or a full prefixed id (HU_BUD), neither of which belongs in copy.
  const state = await db
    .collection<State>("states")
    .findOne(
      { _id: canonicalRegionId(countryId, regionId), countryId },
      { projection: { name: 1 } }
    );
  const regionName = state?.name ?? regionId;

  const title = `${party.name} in ${regionName} | A House Divided`;
  const { name: countryName } = await resolveCountryIdentity(db, countryId);
  const description = `${party.abbreviation ? `${party.abbreviation} · ` : ""}${party.name} in ${regionName}, ${countryName}. Regional support, candidates, and turnout.`;
  const url = `${getSiteUrl()}/country/${code}/region/${regionId}/party/${partyId}`;
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

export default function RegionPartyLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
