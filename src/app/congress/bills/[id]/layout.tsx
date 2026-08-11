import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Bill } from "@/lib/db/types";

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
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const bill = await db
    .collection<Bill>("bills")
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { title: 1, summary: 1, sponsorName: 1, status: 1 } }
    );
  if (!bill) return {};

  const title = `${bill.title} | A House Divided`;
  const description = bill.summary
    ? bill.summary.slice(0, 200)
    : `Sponsored by ${bill.sponsorName}. Status: ${bill.status}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://ahousedividedgame.com/congress/bills/${id}`,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [CDN_LOGO_URL],
    },
  };
}

export default function BillLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
