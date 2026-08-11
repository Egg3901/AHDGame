import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { getWikiSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ key1: string; key2: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  governor: "Governor",
  house: "House",
  senate: "Senate",
  stateSenate: "State Senate",
  president: "President",
  commons: "Parliamentary",
  regionalCouncil: "Regional Council",
  primeMinister: "Prime Minister",
};

const isYearKey = (key: string) => /^\d{4}$/.test(key);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key1: string; key2: string }>;
}): Promise<Metadata> {
  const { key1, key2 } = await params;

  let title: string;
  let description: string;

  if (isYearKey(key1)) {
    const typeLabel = TYPE_LABELS[key2] ?? key2;
    title = `${key1} ${typeLabel} Elections — Wiki | A House Divided`;
    description = `${typeLabel} election results from ${key1}. Historical outcomes, candidates, and margins.`;
  } else {
    const typeLabel = TYPE_LABELS[key1] ?? key1;
    title = `${typeLabel} Elections — ${key2} | A House Divided`;
    description = `${typeLabel} election history for ${key2}. Cycles, winners, and results.`;
  }

  const url = `${getWikiSiteUrl()}/elections/browse/${key1}/${key2}`;

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

export default function WikiBrowseLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
