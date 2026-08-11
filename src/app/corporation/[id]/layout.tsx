import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import { getSiteUrl } from "@/lib/siteMetadata";
import {
  corporationQueryFromParamId,
  resolveCorporation,
} from "@/lib/api/corporations/resolveQuery";
import { PageCountryOverrideBridge } from "@/components/navbar/PageCountryOverrideBridge";

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
  const query = corporationQueryFromParamId(id);
  if (!query) return {};

  const db = await getDb();
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne(query, { projection: { name: 1, type: 1, countryId: 1, logoUrl: 1 } });
  if (!corp) return {};

  const title = `${corp.name} | A House Divided`;
  const description = `${corp.name} — ${corp.type} corporation in ${corp.countryId}. Financials, sectors, shares, and bonds.`;
  const url = `${getSiteUrl()}/corporation/${id}`;
  const image = corp.logoUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: image, width: 512, height: 512, alt: corp.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default async function CorporationLayout({ children, params }: LayoutProps) {
  const { id } = await params;
  const db = await getDb();
  const resolved = await resolveCorporation(db, id);
  const pageCountryId = resolved.ok ? resolved.corporation.countryId : null;

  return (
    <>
      <PageCountryOverrideBridge countryId={pageCountryId} />
      {children}
    </>
  );
}
