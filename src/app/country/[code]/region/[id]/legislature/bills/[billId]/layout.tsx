import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { StateBill } from "@/lib/db/types/stateBill";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ code: string; id: string; billId: string }>;
}

const truncate = (s: string | undefined | null, max = 200) =>
  !s ? "" : s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; id: string; billId: string }>;
}): Promise<Metadata> {
  const { code, id, billId } = await params;
  if (!ObjectId.isValid(billId)) return {};

  const db = await getDb();
  const bill = await db
    .collection<StateBill>("stateBills")
    .findOne(
      { _id: new ObjectId(billId) },
      { projection: { title: 1, summary: 1, sponsorName: 1, status: 1 } }
    );
  if (!bill) return {};

  const title = `${bill.title} | A House Divided`;
  const description =
    truncate(bill.summary) || `Sponsored by ${bill.sponsorName}. Status: ${bill.status}.`;
  const url = `${getSiteUrl()}/country/${code}/region/${id}/legislature/bills/${billId}`;

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

export default function RegionBillLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
