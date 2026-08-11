import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import type { Coalition } from "@/lib/db/types/coalition";
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
  const coalition = await db
    .collection<Coalition>("coalitions")
    .findOne({ sequentialId, countryId }, { projection: { name: 1 } });
  if (!coalition) return {};

  const title = `${coalition.name} | A House Divided`;
  const description = `${coalition.name} — coalition in ${countryId}. Member parties, leadership, and combined legislative power.`;
  const url = `${getSiteUrl()}/country/${code}/parties/coalition/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: coalition.name }],
    },
    twitter: { card: "summary", title, description, images: [CDN_LOGO_URL] },
  };
}

export default function CountryCoalitionLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
