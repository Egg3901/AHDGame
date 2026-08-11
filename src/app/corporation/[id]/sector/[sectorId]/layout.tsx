import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { State } from "@/lib/db/types";
import { getSiteUrl } from "@/lib/siteMetadata";
import {
  corporationQueryFromParamId,
  resolveCorporation,
} from "@/lib/api/corporations/resolveQuery";
import { PageCountryOverrideBridge } from "@/components/navbar/PageCountryOverrideBridge";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; sectorId: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; sectorId: string }>;
}): Promise<Metadata> {
  const { id, sectorId } = await params;
  const corpQuery = corporationQueryFromParamId(id);
  if (!corpQuery || !ObjectId.isValid(sectorId)) return {};

  const db = await getDb();
  const [corp, sector] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .findOne(corpQuery, { projection: { name: 1, logoUrl: 1, countryId: 1 } }),
    db
      .collection<CorporateSector>("corporateSectors")
      .findOne(
        { _id: new ObjectId(sectorId) },
        { projection: { sectorType: 1, displayName: 1, stateId: 1 } }
      ),
  ]);
  if (!corp || !sector) return {};

  const sectorLabel = sector.displayName || sector.sectorType;
  const title = `${sectorLabel} — ${corp.name} | A House Divided`;
  const description = `${sectorLabel} sector operated by ${corp.name} in ${sector.stateId}. Production, financials, and market position.`;
  const url = `${getSiteUrl()}/corporation/${id}/sector/${sectorId}`;
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

export default async function SectorLayout({ children, params }: LayoutProps) {
  const { id, sectorId } = await params;
  const db = await getDb();
  const resolved = await resolveCorporation(db, id);

  let pageCountryId: string | null = null;
  if (resolved.ok) {
    pageCountryId = resolved.corporation.countryId;
    if (ObjectId.isValid(sectorId)) {
      const sector = await db
        .collection<CorporateSector>("corporateSectors")
        .findOne(
          { _id: new ObjectId(sectorId), corporationId: resolved.corporation._id },
          { projection: { countryId: 1, stateId: 1 } }
        );

      if (sector?.countryId) {
        pageCountryId = sector.countryId;
      } else if (sector?.stateId) {
        const state = await db
          .collection<State>("states")
          .findOne({ _id: sector.stateId }, { projection: { countryId: 1 } });
        pageCountryId = state?.countryId ?? pageCountryId;
      }
    }
  }

  return (
    <>
      <PageCountryOverrideBridge countryId={pageCountryId} />
      {children}
    </>
  );
}
