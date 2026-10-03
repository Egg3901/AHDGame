import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/siteMetadata";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getOfficeTypeConfig,
  type CountryId,
} from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { cabinetIdentityVars } from "@/lib/constants/cabinetIdentity";
import "./cabinetDossier.css";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string; positionId: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; positionId: string }>;
}): Promise<Metadata> {
  const { code, positionId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};
  const db = await getDb();
  if (!(await isCountryEnabledForPlayers(db, countryId))) return {};

  const country = getCountryConfig(countryId);
  const office = getOfficeTypeConfig(countryId, positionId);
  const label = office?.label ?? positionId;

  const title = `${label} — ${country.name} | A House Divided`;
  const description = `Office of the ${label} in ${country.name}. Actions, nominations, and delegated authority.`;
  const url = `${getSiteUrl()}/country/${code}/executive/cabinet/${positionId}/office`;

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

export default async function CabinetOfficeLayout({ children, params }: LayoutProps) {
  const { code } = await params;
  const countryId = code.toUpperCase();

  return (
    <div data-cabinet-dossier style={cabinetIdentityVars(countryId)}>
      {children}
    </div>
  );
}
