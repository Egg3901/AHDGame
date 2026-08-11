import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getLearningPathBySlug } from "@/lib/wiki/learningPaths";
import { getWikiSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ pathId: string }>;
}

const truncate = (s: string | undefined | null, max = 200) =>
  !s ? "" : s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pathId: string }>;
}): Promise<Metadata> {
  const { pathId } = await params;
  const path = getLearningPathBySlug(pathId);
  if (!path) return {};

  const title = `${path.title} — Learning Path | A House Divided`;
  const description =
    truncate(path.description) || `${path.title}: a curated guide for learning A House Divided.`;
  const url = `${getWikiSiteUrl()}/paths/${pathId}`;

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

export default function WikiPathLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
