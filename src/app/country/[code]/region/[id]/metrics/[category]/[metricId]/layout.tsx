import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/siteMetadata";
import { ALL_METRIC_DEFS } from "./metricDefs";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string; id: string; category: string; metricId: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; id: string; category: string; metricId: string }>;
}): Promise<Metadata> {
  const { code, id, category, metricId } = await params;

  const def = ALL_METRIC_DEFS[category]?.[metricId];
  // Honour per-region label overrides so OG/SEO titles read "Reunification
  // Desire" in NIR instead of the generic "Independence Desire".
  const label = def?.regionDisplayNames?.[id.toUpperCase()] ?? def?.name ?? metricId;
  const title = `${label} — ${id} | A House Divided`;
  const description = def?.description ?? `${label} trend for ${id}, updated every turn.`;
  const url = `${getSiteUrl()}/country/${code}/region/${id}/metrics/${category}/${metricId}`;

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

export default function RegionMetricLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
