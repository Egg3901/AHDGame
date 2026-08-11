import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};
  const db = await getDb();
  if (!(await isCountryEnabledForPlayers(db, countryId))) return {};
  const country = getCountryConfig(countryId);

  const title = `${country.name} Policy | A House Divided`;
  const description = `Active policies and regulatory settings shaping ${country.name}'s economy and society.`;
  const url = `${getSiteUrl()}/country/${code}/policy`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: { card: "summary", title, description, images: [CDN_LOGO_URL] },
  };
}

export default function CountryPolicyLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
