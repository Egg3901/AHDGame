import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return {};

    const db = await getDb();
    const bond = await db.collection<Bond>("bonds").findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          issuerName: 1,
          issuerType: 1,
          countryId: 1,
          maturityTurns: 1,
          couponRate: 1,
          faceValue: 1,
        },
      }
    );
    if (!bond) return {};

    const issuer = bond.issuerName ?? (bond.issuerType === "sovereign" ? "Sovereign" : "Corporate");
    const maturity = bond.maturityTurns ? BOND_MATURITY_LABELS[bond.maturityTurns] : "";
    const coupon =
      typeof bond.couponRate === "number" ? `${bond.couponRate.toFixed(2)}% coupon` : "";
    const label = [issuer, maturity, "Bond"].filter(Boolean).join(" ");
    const title = `${label} | A House Divided`;
    const description = [
      `Issuer: ${issuer}`,
      maturity && `Maturity: ${maturity}`,
      coupon,
      bond.countryId && `Country: ${bond.countryId}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const url = `${getSiteUrl()}/bond/${id}`;

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
  } catch {
    return {};
  }
}

export default function BondLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
