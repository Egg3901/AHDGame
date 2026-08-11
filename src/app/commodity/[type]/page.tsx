import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import BackButton from "@/components/BackButton";
import { getCommodityDetailData } from "../../api/commodities/[type]/route";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_TYPES, COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { CommodityDetail } from "./types";
import CommodityDetailClient from "./CommodityDetailClient";
import { getSiteUrl } from "@/lib/siteMetadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  const commodity = type as CommodityType;
  if (!COMMODITY_TYPES.includes(commodity)) return {};

  const label = COMMODITY_LABELS[commodity] ?? commodity;
  const title = `${label} Market | A House Divided`;
  const description = `Live ${label.toLowerCase()} prices, production, consumption, and trade flows across all countries.`;
  const url = `${getSiteUrl()}/commodity/${type}`;

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

function CommodityErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
          <h2 className="text-lg font-semibold text-error">{message}</h2>
          <BackButton />
        </div>
      </main>
    </div>
  );
}

export default async function CommodityDetailPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  let errorMessage = "";
  let data = null as CommodityDetail | null;

  try {
    const { type } = await params;
    const commodity = type as CommodityType;

    if (!COMMODITY_TYPES.includes(commodity)) {
      errorMessage = "Commodity not found";
    } else {
      data = await getCommodityDetailData(commodity, { includeHeavy: false });
    }
  } catch {
    errorMessage = "Network error";
  }

  if (errorMessage || !data) {
    return <CommodityErrorState message={errorMessage || "Commodity not found"} />;
  }

  return <CommodityDetailClient key={data.commodity} initialData={data} />;
}
